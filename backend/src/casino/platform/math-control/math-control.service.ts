import {
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { PrismaService } from '../../../prisma.service';
import { hasCapability } from '../../../auth/capabilities';
import { canonicalProfileHash } from './math-control.analytics';
import { writeValidationArtifacts } from './math-control.artifacts';
import { validatePolicy } from './math-control.policy';
import { GameMathRegistry } from './math-control.registry';
import { MathControlJobs } from './math-control.jobs';
import {
  defaultSessionConfig,
} from './math-control.bankroll';
import type {
  MathPolicy,
  MathProfileArtifact,
  MathValidationEvidence,
  GameMathAdapter,
  ProfileValidationOutcome,
  SessionConfig,
  ValidationOptions,
} from './math-control.types';

/**
 * Game Math Control: generate, validate, activate.
 *
 * The service owns the lifecycle and the security boundary and nothing else:
 *
 *  - generation input is bounded policy only, re-validated here after the
 *    transport whitelist;
 *  - an artifact hash covers identity, engine identity, policy and payload, so
 *    validation, activation and status changes can never alter a profile;
 *  - validation is server-produced evidence from the game's own adapter;
 *  - activation needs a passing validation whose recorded hash still matches
 *    the frozen artifact, and moves a durable per-game pointer under optimistic
 *    concurrency.
 *
 * No path here can change an outcome, a stake, a player's balance or a round
 * already in flight.
 */
@Injectable()
export class MathControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: GameMathRegistry,
    private readonly jobs: MathControlJobs,
  ) {}

  private async assertAdmin(actorId: string, operation: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: actorId }, select: { role: true, disabled: true } });
    if (actor && !actor.disabled && hasCapability(actor.role, 'GAME_MATH_MANAGE')) return;
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: operation,
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { operation },
      },
    });
    throw new ForbiddenException('ADMIN_REQUIRED');
  }

  async overview(actorId: string) {
    await this.assertAdmin(actorId, 'CASINO_MATH_OVERVIEW');
    const games = this.registry.gameIds();
    const [profiles, actives] = await Promise.all([
      this.prisma.gameMathProfile.findMany({
        where: { gameId: { in: games } },
        orderBy: [{ createdAt: 'desc' }],
        select: {
          gameId: true, profileId: true, canonicalHash: true, status: true,
          targetRtpPercent: true, measuredRtpPercent: true, maxWinMultiplier: true, createdAt: true,
        },
      }),
      this.prisma.gameActiveMathProfile.findMany({ where: { gameId: { in: games } } }),
    ]);
    return {
      games: games.map((gameId) => ({
        gameId,
        active: actives.find((row) => row.gameId === gameId) ?? null,
        profiles: profiles.filter((row) => row.gameId === gameId),
      })),
      note:
        'Profiles are immutable. Generating never changes what is live; activation is a separate, ' +
        'audited step that affects new paid rounds only.',
    };
  }

  async capabilities(actorId: string, gameId: string) {
    await this.assertAdmin(actorId, 'CASINO_MATH_CAPABILITIES');
    const adapter = this.registry.adapter(gameId);
    return {
      capabilities: await adapter.capabilities(),
      reachableOutcomeClasses: await adapter.getReachableOutcomeClasses(),
    };
  }

  async listProfiles(actorId: string, gameId: string) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PROFILES');
    this.registry.adapter(gameId);
    const [profiles, active] = await Promise.all([
      this.prisma.gameMathProfile.findMany({
        where: { gameId },
        orderBy: [{ createdAt: 'desc' }],
        include: {
          validations: {
            orderBy: [{ createdAt: 'desc' }],
            take: 1,
            select: { id: true, result: true, createdAt: true, artifactPath: true },
          },
        },
      }),
      this.prisma.gameActiveMathProfile.findUnique({ where: { gameId } }),
    ]);
    return {
      gameId,
      active,
      profiles: profiles.map((row) => ({
        ...this.summarize(row),
        latestValidation: row.validations[0] ?? null,
      })),
    };
  }

  async profileDetail(actorId: string, gameId: string, profileId: string) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PROFILE');
    const row = await this.loadProfile(gameId, profileId);
    const [validations, active] = await Promise.all([
      this.prisma.gameMathProfileValidation.findMany({
        where: { profileRowId: row.id },
        orderBy: [{ createdAt: 'desc' }],
      }),
      this.prisma.gameActiveMathProfile.findUnique({ where: { gameId } }),
    ]);
    return {
      profile: { ...this.summarize(row), analytic: row.analytic, policy: row.policy },
      active: active?.profileId === profileId,
      validations: validations.map((entry) => ({
        id: entry.id,
        result: entry.result,
        createdAt: entry.createdAt,
        artifactPath: entry.artifactPath,
        metrics: entry.metrics,
        bankroll: entry.bankroll,
        checks: entry.checks,
      })),
    };
  }

  /** Validate a bounded policy and return either a new profile or the reasons. */
  async generate(actorId: string, gameId: string, raw: Record<string, unknown>) {
    await this.assertAdmin(actorId, 'CASINO_MATH_GENERATE');
    const adapter = this.registry.adapter(gameId);
    const parsed = validatePolicy({ ...raw, gameId });
    if (!parsed.ok) return { status: 'INVALID_POLICY' as const, errors: parsed.errors };

    const generated = await this.jobs.run(
      {
        kind: 'GENERATE',
        gameId,
        actorId,
        worker: workerPayload(adapter, 'GENERATE', { policy: parsed.policy }),
      },
      () => adapter.generateProfile(parsed.policy),
    );
    const result = generated.result;
    if (result.status === 'UNSUPPORTED') {
      await this.audit(actorId, gameId, 'CASINO_MATH_PROFILE_GENERATED', {
        outcome: 'UNSUPPORTED',
        requestedTarget: parsed.policy.targetRtpPercent,
        reasons: result.reasons.map((reason) => reason.constraint),
      });
      return {
        status: 'UNSUPPORTED' as const,
        reasons: result.reasons,
        bestEffort: result.bestEffort,
        policy: parsed.policy,
        execution: generated.job.execution,
      };
    }

    const artifact = result.artifact;
    const recomputed = canonicalProfileHash(artifact);
    if (recomputed !== artifact.canonicalHash) {
      throw new InternalServerErrorException({
        code: 'MATH_ARTIFACT_HASH_MISMATCH',
        message: 'The generated artifact hash does not match its own content.',
      });
    }

    const existing = await this.prisma.gameMathProfile.findUnique({
      where: { gameId_canonicalHash: { gameId, canonicalHash: artifact.canonicalHash } },
    });
    if (existing) {
      return {
        status: 'SUPPORTED' as const,
        created: false,
        profile: this.summarize(existing),
        analysis: result.analysis,
      };
    }

    const row = await this.prisma.gameMathProfile.create({
      data: {
        gameId,
        profileId: artifact.profileId,
        canonicalHash: artifact.canonicalHash,
        engineSha256: artifact.engineSha256,
        rulesSha256: artifact.rulesSha256,
        targetRtpPercent: new Prisma.Decimal(parsed.policy.targetRtpPercent.toString()),
        measuredRtpPercent: null,
        maxWinMultiplier: new Prisma.Decimal(
          (Number.isFinite(result.analysis.maxRoundMultiplier)
            ? (result.analysis.maxRoundMultiplier as number)
            : parsed.policy.maxWinMultiplier).toFixed(6),
        ),
        policy: parsed.policy as unknown as Prisma.InputJsonValue,
        analytic: result.analysis as unknown as Prisma.InputJsonValue,
        payload: artifact.payload as Prisma.InputJsonValue,
        status: 'DRAFT',
        generatedBy: actorId,
      },
    });
    await this.audit(actorId, gameId, 'CASINO_MATH_PROFILE_GENERATED', {
      outcome: 'DRAFT',
      profileId: row.profileId,
      canonicalHash: row.canonicalHash,
      targetRtpPercent: parsed.policy.targetRtpPercent,
    });
    return {
      status: 'SUPPORTED' as const,
      created: true,
      profile: this.summarize(row),
      analysis: result.analysis,
      execution: generated.job.execution,
      calibration: result.calibration,
    };
  }

  /**
   * Independent validation of a frozen profile.
   *
   * The artifact is rebuilt from the stored row and its hash re-derived first,
   * so a tampered or substituted payload fails closed before any simulation
   * runs.
   */
  async validate(actorId: string, gameId: string, profileId: string, overrides: Partial<ValidationOptions> = {}) {
    await this.assertAdmin(actorId, 'CASINO_MATH_VALIDATE');
    const adapter = this.registry.adapter(gameId);
    const row = await this.loadProfile(gameId, profileId);
    const artifact = this.artifactFromRow(row);
    const policy = artifact.policy;

    const previous = await this.prisma.gameMathProfileValidation.count({ where: { profileRowId: row.id } });
    const attempt = previous + 1;
    const options: ValidationOptions = {
      validationSeedPrefix: `validation:${artifact.canonicalHash}:${attempt}`,
      bankrollSeedPrefix: `bankroll:${artifact.canonicalHash}:${attempt}`,
      monteCarloRounds: clampInt(overrides.monteCarloRounds ?? 25_000, 1_000, MAX_MONTE_CARLO_ROUNDS),
      bankrollSessions: clampInt(overrides.bankrollSessions ?? 400, 10, MAX_BANKROLL_SESSIONS),
      sessionConfig: clampSessionConfig(overrides.sessionConfig ?? defaultSessionConfig()),
      rtpTolerancePercent: overrides.rtpTolerancePercent ?? 0.25,
    };

    const validated = await this.jobs.run<ProfileValidationOutcome>(
      {
        kind: 'VALIDATE',
        gameId,
        actorId,
        worker: workerPayload(adapter, 'VALIDATE', { policy, artifact, options }),
      },
      () => adapter.validateProfile(policy, artifact, options),
    );
    const outcome = validated.result;
    const execution = validated.job.execution;
    const engine = adapter.identity();
    if (artifact.engineSha256 !== engine.engineSha256 || artifact.rulesSha256 !== engine.rulesSha256) {
      throw new ConflictException({
        code: 'MATH_ENGINE_MISMATCH',
        message:
          `Profile was generated against engine ${artifact.engineSha256}/${artifact.rulesSha256}, ` +
          `this process runs ${engine.engineSha256}/${engine.rulesSha256}.`,
      });
    }

    const evidence: MathValidationEvidence = {
      validationId: 'pending',
      profileId: artifact.profileId,
      gameId,
      profileHash: artifact.canonicalHash,
      engineSha256: artifact.engineSha256,
      rulesSha256: artifact.rulesSha256,
      createdAt: new Date().toISOString(),
      seeds: {
        calibrationPrefix: 'calibration (generation-time search, no sampled seeds)',
        validationPrefix: options.validationSeedPrefix,
        bankrollPrefix: options.bankrollSeedPrefix,
      },
      runs: outcome.runs,
      metrics: outcome.metrics,
      bankroll: outcome.bankroll,
      checks: outcome.checks,
      result: outcome.result,
      grade: outcome.grade,
    };

    // Evidence is written to disk before the row is committed, so a committed
    // validation always has the files its artifactPath points at.
    const paths = writeValidationArtifacts(evidence, attempt);

    const validation = await this.prisma.gameMathProfileValidation.create({
      data: {
        profileRowId: row.id,
        gameId,
        profileId: artifact.profileId,
        profileHash: artifact.canonicalHash,
        result: outcome.result,
        metrics: {
          ...(outcome.metrics as unknown as Record<string, unknown> ?? {}),
          grade: outcome.grade,
        } as Prisma.InputJsonValue,
        bankroll: outcome.bankroll as unknown as Prisma.InputJsonValue,
        checks: outcome.checks as unknown as Prisma.InputJsonValue,
        runs: outcome.runs as unknown as Prisma.InputJsonValue,
        artifactPath: paths.relativeJson,
        validatedBy: actorId,
      },
    });
    evidence.validationId = validation.id;
    writeValidationArtifacts(evidence, attempt);

    await this.prisma.gameMathProfile.update({
      where: { id: row.id },
      data: {
        status: outcome.result === 'PASS' ? 'VALIDATED' : 'REJECTED',
        measuredRtpPercent: new Prisma.Decimal((outcome.metrics?.measuredRtpPercent ?? 0).toFixed(6)),
      },
    });
    await this.audit(actorId, gameId, 'CASINO_MATH_PROFILE_VALIDATED', {
      profileId: artifact.profileId,
      canonicalHash: artifact.canonicalHash,
      result: outcome.result,
      grade: outcome.grade,
      execution,
      failedChecks: outcome.checks.filter((entry) => entry.status !== 'PASS').map((entry) => entry.id),
    });
    return { evidence, artifactPath: paths.relativeJson, paths, execution };
  }

  /**
   * Activation. The profile hash, engine identity and a passing validation are
   * all re-checked inside the transaction that moves the active pointer.
   */
  async activate(actorId: string, gameId: string, profileId: string, expectedVersion?: number) {
    await this.assertAdmin(actorId, 'CASINO_MATH_ACTIVATE');
    const adapter = this.registry.adapter(gameId);
    const engine = adapter.identity();

    // Every gate is evaluated inside the transaction that moves the pointer:
    // the stored profile, its hash, its status, its passing validation, the
    // evaluator this process runs, and the required evidence checks.
    const pointer = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gameMathProfile.findUnique({
        where: { gameId_profileId: { gameId, profileId } },
      });
      if (!row) {
        throw new NotFoundException({ code: 'MATH_PROFILE_NOT_FOUND', message: `No mathematics ${gameId}/${profileId}.` });
      }
      const artifact = this.artifactFromRow(row);

      if (row.engineSha256 !== engine.engineSha256 || row.rulesSha256 !== engine.rulesSha256) {
        throw new ConflictException({
          code: 'MATH_ENGINE_MISMATCH',
          message:
            `Profile was generated against engine ${row.engineSha256}/${row.rulesSha256}, this process runs ` +
            `${engine.engineSha256}/${engine.rulesSha256}.`,
        });
      }

      const validation = await tx.gameMathProfileValidation.findFirst({
        where: { profileRowId: row.id, result: 'PASS', profileHash: artifact.canonicalHash },
        orderBy: [{ createdAt: 'desc' }],
      });
      if (!validation) {
        throw new ConflictException({
          code: 'MATH_PROFILE_NOT_VALIDATED',
          message: 'This mathematics has no passing validation against its current hash.',
        });
      }
      if (row.status !== 'VALIDATED') {
        throw new ConflictException({
          code: 'MATH_PROFILE_STATUS_NOT_ACTIVATABLE',
          message: `Only validated mathematics can be activated (status ${row.status}).`,
        });
      }

      const checks = (validation.checks ?? []) as Array<{ id: string; status: string; value?: unknown }>;
      const failed = checks.filter((entry) => entry.status !== 'PASS').map((entry) => entry.id);
      const missing = REQUIRED_ACTIVATION_CHECKS.filter((id) => !checks.some((entry) => entry.id === id));
      const grade = ((validation.metrics ?? {}) as { grade?: string }).grade ?? 'PREVIEW';
      if (missing.length > 0 || failed.length > 0 || grade !== 'ACTIVATION') {
        throw new ConflictException({
          code: 'MATH_EVIDENCE_INCOMPLETE',
          message:
            'Activation requires a completed activation-grade validation with every required check passing.',
          ...({ missing, failed, grade } as Record<string, unknown>),
        });
      }

      const provedMax = provedMaximum(checks);
      assertGambleScopeResolved(artifact.policy.maxWinScope, provedMax);

      const current = await tx.gameActiveMathProfile.findUnique({ where: { gameId } });
      if (current && expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConflictException({
          code: 'ACTIVE_MATH_PROFILE_CONFLICT',
          message: `Active mathematics moved to version ${current.version}.`,
        });
      }
      if (!current) {
        try {
          const created = await tx.gameActiveMathProfile.create({
            data: {
              gameId,
              profileRowId: row.id,
              profileId: artifact.profileId,
              profileHash: artifact.canonicalHash,
              validationId: validation.id,
              version: 1,
              activatedBy: actorId,
            },
          });
          await this.auditIn(tx, actorId, gameId, 'CASINO_MATH_PROFILE_ACTIVATED', {
            profileId: artifact.profileId,
            canonicalHash: artifact.canonicalHash,
            validationId: validation.id,
            grade,
            version: created.version,
          });
          return created;
        } catch (error) {
          // Two simultaneous first activations: the unique primary key decides.
          if (isUniqueViolation(error)) {
            throw new ConflictException({
              code: 'ACTIVE_MATH_PROFILE_CONFLICT',
              message: 'Another activation created the pointer first; reload and retry.',
            });
          }
          throw error;
        }
      }
      const updated = await tx.gameActiveMathProfile.updateMany({
        where: { gameId, version: current.version },
        data: {
          profileRowId: row.id,
          profileId: artifact.profileId,
          profileHash: artifact.canonicalHash,
          validationId: validation.id,
          version: current.version + 1,
          activatedBy: actorId,
          activatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException({
          code: 'ACTIVE_MATH_PROFILE_CONFLICT',
          message: 'Another activation won the race; reload and retry.',
        });
      }
      const next = await tx.gameActiveMathProfile.findUniqueOrThrow({ where: { gameId } });
      await this.auditIn(tx, actorId, gameId, 'CASINO_MATH_PROFILE_ACTIVATED', {
        profileId: artifact.profileId,
        canonicalHash: artifact.canonicalHash,
        validationId: validation.id,
        grade,
        version: next.version,
      });
      return next;
    });

    return {
      gameId,
      profileId: pointer.profileId,
      profileHash: pointer.profileHash,
      validationId: pointer.validationId,
      version: pointer.version,
      activatedAt: pointer.activatedAt.toISOString(),
    };
  }

  /**
   * The runtime seam: the profile a NEW paid round must pin.
   *
   * Returns `null` when no profile has ever been activated, which leaves the
   * game on its own accepted default mathematics. The stored artifact hash is
   * re-derived on every read, so a tampered row fails closed instead of
   * silently changing payouts.
   */
  async activeProfile(gameId: string): Promise<{ artifact: MathProfileArtifact; validationId: string | null; version: number } | null> {
    const pointer = await this.prisma.gameActiveMathProfile.findUnique({ where: { gameId } });
    // No pointer at all is the accepted "never activated" default. An explicit
    // `DEFAULT` tombstone keeps the monotonic revision but also leaves the game
    // on its immutable golden mathematics, so the runtime falls back exactly as
    // it does before the first activation.
    if (!pointer || pointer.kind === 'DEFAULT' || pointer.profileRowId === null) return null;
    const row = await this.prisma.gameMathProfile.findUnique({ where: { id: pointer.profileRowId } });
    if (!row) {
      throw new InternalServerErrorException({
        code: 'MATH_ACTIVE_PROFILE_MISSING',
        message: 'The active mathematics pointer references a missing profile.',
      });
    }
    const artifact = this.artifactFromRow(row);
    if (artifact.canonicalHash !== pointer.profileHash) {
      throw new InternalServerErrorException({
        code: 'MATH_ARTIFACT_HASH_MISMATCH',
        message: 'The active mathematics row does not match the activated hash.',
      });
    }
    return { artifact, validationId: pointer.validationId, version: pointer.version };
  }

  private async loadProfile(gameId: string, profileId: string) {
    const row = await this.prisma.gameMathProfile.findUnique({ where: { gameId_profileId: { gameId, profileId } } });
    if (!row) {
      throw new NotFoundException({ code: 'MATH_PROFILE_NOT_FOUND', message: `No mathematics ${gameId}/${profileId}.` });
    }
    return row;
  }

  /** Rebuild the immutable artifact and verify it against its stored hash. */
  private artifactFromRow(row: {
    profileId: string;
    gameId: string;
    engineSha256: string;
    rulesSha256: string;
    policy: Prisma.JsonValue;
    payload: Prisma.JsonValue;
    canonicalHash: string;
    createdAt: Date;
  }): MathProfileArtifact {
    const artifact: MathProfileArtifact = {
      schemaVersion: 1,
      profileId: row.profileId,
      gameId: row.gameId,
      engineSha256: row.engineSha256,
      rulesSha256: row.rulesSha256,
      policy: row.policy as unknown as MathPolicy,
      payload: row.payload,
      canonicalHash: row.canonicalHash,
      createdAt: row.createdAt.toISOString(),
    };
    const recomputed = canonicalProfileHash(artifact);
    if (recomputed !== row.canonicalHash) {
      throw new InternalServerErrorException({
        code: 'MATH_ARTIFACT_HASH_MISMATCH',
        message: `Stored mathematics ${row.gameId}/${row.profileId} does not match its canonical hash.`,
      });
    }
    return artifact;
  }

  private summarize(row: {
    gameId: string;
    profileId: string;
    canonicalHash: string;
    status: string;
    targetRtpPercent: Prisma.Decimal;
    measuredRtpPercent: Prisma.Decimal | null;
    maxWinMultiplier: Prisma.Decimal;
    createdAt: Date;
  }) {
    return {
      gameId: row.gameId,
      profileId: row.profileId,
      canonicalHash: row.canonicalHash,
      status: row.status,
      targetRtpPercent: row.targetRtpPercent.toString(),
      measuredRtpPercent: row.measuredRtpPercent?.toString() ?? null,
      maxWinMultiplier: row.maxWinMultiplier.toString(),
      createdAt: row.createdAt.toISOString(),
    };
  }

  private audit(actorId: string, gameId: string, action: 'CASINO_MATH_PROFILE_GENERATED' | 'CASINO_MATH_PROFILE_VALIDATED' | 'CASINO_MATH_PROFILE_ACTIVATED', metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: gameId,
        action,
        result: 'OK',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }

  /** The activation audit row commits in the same transaction as the pointer. */
  private auditIn(
    tx: Prisma.TransactionClient,
    actorId: string,
    gameId: string,
    action: 'CASINO_MATH_PROFILE_ACTIVATED',
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: gameId,
        action,
        result: 'OK',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
  }
}

// ---------------------------------------------------------------------------
// Bounded work and activation gates
// ---------------------------------------------------------------------------

/** Hard ceilings: no admin input can schedule unbounded work in a request. */
export const MAX_MONTE_CARLO_ROUNDS = 200_000;
export const MAX_BANKROLL_SESSIONS = 2_000;
export const MAX_BANKROLL_HORIZON = 50_000;
export const MAX_COHORT_WORK_UNITS = 5_000_000;

export const REQUIRED_ACTIVATION_CHECKS = [
  'EXACT_RTP_MATCHES_TARGET',
  'MONTE_CARLO_CI_COVERS_TARGET',
  'MAX_WIN_PROVEN_WITHIN_CEILING',
  'RTP_WITHIN_BOUND_TIMES_HIT_RATE',
  'BANKROLL_COHORT_COMPLETED',
  'BANKROLL_ACCOUNTING_EXACT',
  'EVIDENCE_GRADE_ACTIVATION',
] as const;

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Clamp a cohort into the bounded work envelope the platform will execute. */
export function clampSessionConfig(config: SessionConfig): SessionConfig {
  const horizonPaidSpins = clampInt(config.horizonPaidSpins, 100, MAX_BANKROLL_HORIZON);
  const within = (value: number) => Number.isSafeInteger(value) && value > 0 && value <= horizonPaidSpins;
  const checkpoints = (list: number[]) => {
    const kept = list.filter(within);
    return kept.length > 0 ? kept : [horizonPaidSpins];
  };
  return {
    ...config,
    horizonPaidSpins,
    aliveCheckpoints: checkpoints(config.aliveCheckpoints),
    balanceCheckpoints: checkpoints(config.balanceCheckpoints),
    ruinCheckpoints: checkpoints(config.ruinCheckpoints),
  };
}

/**
 * The pending gamble-scope question, as an explicit fail-closed gate.
 *
 * Until the operator records a decision, a profile whose paid round can return
 * anything at all cannot be activated: its settled win could be doubled by the
 * optional gamble without any attempt cap, so no finite total ceiling is true.
 * A profile proved to pay nothing never offers the gamble and is unaffected.
 */
export type GambleScopeDecision = 'PENDING' | 'EXCLUDE_OPTIONAL_GAMBLE' | 'INCLUDE_OPTIONAL_GAMBLE';

export function gambleScopeDecision(): GambleScopeDecision {
  const value = process.env.MATH_CONTROL_GAMBLE_SCOPE_DECISION as GambleScopeDecision | undefined;
  return value ?? 'PENDING';
}

export function assertGambleScopeResolved(scope: string, provedMaximumMultiplier: number | null) {
  if (scope === 'TOTAL_INCLUDING_OPTIONAL_GAMBLE') {
    throw new ConflictException({
      code: 'GAMBLE_UNBOUNDED_TOTAL_CEILING',
      message: 'A ceiling that includes the optional gamble cannot be proved for this game.',
    });
  }
  if (gambleScopeDecision() !== 'PENDING') return;
  const paysAnything = provedMaximumMultiplier === null || provedMaximumMultiplier > 0;
  if (!paysAnything) return;
  throw new ConflictException({
    code: 'GAMBLE_SCOPE_PENDING_USER_DECISION',
    message:
      'The max-win scope decision is still pending. Activating mathematics whose paid round can return ' +
      'anything would advertise a ceiling the optional red/black gamble can exceed, so activation is blocked ' +
      'until the decision is recorded (only a provably zero-return profile is unaffected).',
  });
}

/** The proved complete-round ceiling recorded by the validation checks. */
export function provedMaximum(checks: Array<{ id: string; status: string; value?: unknown }>): number | null {
  const entry = checks.find((candidate) => candidate.id === 'MAX_WIN_PROVEN_WITHIN_CEILING');
  const value = entry?.value as { provedMax?: unknown } | undefined;
  const proved = value?.provedMax;
  return typeof proved === 'number' && Number.isFinite(proved) ? proved : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/** Worker descriptor for one bounded job, or `undefined` for the in-process path. */
function workerPayload(
  adapter: GameMathAdapter,
  kind: 'GENERATE' | 'VALIDATE',
  extra: { policy?: unknown; artifact?: unknown; options?: unknown },
) {
  const worker = adapter.workerModule();
  if (!worker) return undefined;
  return { kind, modulePath: worker.modulePath, exportName: worker.exportName, ...extra };
}
