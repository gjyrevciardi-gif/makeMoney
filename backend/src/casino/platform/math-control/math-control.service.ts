import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
import {
  GAME_MATH_DEFAULT_RESETTERS,
  GAME_MATH_LIFECYCLE_OWNERS,
  type GameMathAdapter,
  type GameMathDefaultResetter,
  type GameMathDefaultResult,
  type GameMathHistoryEntry,
  type GameMathHistoryView,
  type GameMathLifecycleOwner,
  type GameMathRollbackResult,
  type GameMathStateRef,
  type MathPolicy,
  type MathProfileArtifact,
  type MathValidationEvidence,
  type ProfileValidationOutcome,
  type SessionConfig,
  type ValidationOptions,
} from './math-control.types';

/** The three lifecycle transitions the shared history is made of. */
const LIFECYCLE_ACTIONS = ['ACTIVATE', 'ROLLBACK', 'DEFAULT'] as const;

/** A game's resolved mathematics state, as a transition records it. */
type LifecycleSnapshot = {
  mode: 'DEFAULT' | 'CUSTOM';
  version: number;
  profileId: string | null;
};

/** The columns of one append-only lifecycle row this service reads or writes. */
type LifecycleRow = {
  id: string;
  actionId: string;
  action: string;
  candidateId: string | null;
  modelProfileId: string | null;
  modelHash: string | null;
  version: number;
  actorId: string;
  previous: Prisma.JsonValue;
  createdAt: Date;
};

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
    // A game whose default state is owned by its own admin panel registers one
    // delegate here; the shared pointer move below is the fallback. Optional so
    // existing direct constructions in tests keep working.
    @Optional() @Inject(GAME_MATH_DEFAULT_RESETTERS)
    private readonly defaultResetters: GameMathDefaultResetter[] = [],
    // A game whose whole lifecycle is owned by its own admin panel registers one
    // owner here; the generic history reads that panel's own rows and the
    // generic rollback runs that panel's own transition. Optional for the same
    // reason as above.
    @Optional() @Inject(GAME_MATH_LIFECYCLE_OWNERS)
    private readonly lifecycleOwners: GameMathLifecycleOwner[] = [],
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
        // Persist the artifact's own policy, not the raw request: an adapter may
        // stamp explicit metadata that is part of the frozen hash (Classic stamps
        // `maxWinEnabled: true` for a RESOLVED_SPIN profile). Storing the request
        // would make artifactFromRow re-derive a different hash and fail every
        // later validate/activate with MATH_ARTIFACT_HASH_MISMATCH.
        policy: artifact.policy as unknown as Prisma.InputJsonValue,
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
      const { row, artifact, validation, grade } = await this.requireActivatable(tx, gameId, profileId, engine);

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
          await this.recordSharedTransition(tx, {
            gameId,
            actionId: `math-activate-${gameId}-${randomUUID()}`,
            action: 'ACTIVATE',
            actorId,
            semantics: `ACTIVATE:${artifact.profileId}:expected=${expectedVersion ?? 'any'}`,
            version: created.version,
            profileId: artifact.profileId,
            profileHash: artifact.canonicalHash,
            previous: this.stateSnapshotOf(null),
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
          // A shared activation is the platform's CUSTOM state: the pointer must
          // stop advertising the DEFAULT tombstone it may be leaving, exactly as
          // the create() branch above does through the column default. Without
          // this the runtime seam keeps reading `kind === 'DEFAULT'` and returns
          // null for a profile that is genuinely active.
          kind: 'GENERATED',
          // The shared lifecycle never binds a panel payout candidate, so a
          // candidate id left on the pointer by a panel transition must not
          // outlive it; the create() branch leaves this column null.
          payoutCandidateId: null,
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
      await this.recordSharedTransition(tx, {
        gameId,
        actionId: `math-activate-${gameId}-${randomUUID()}`,
        action: 'ACTIVATE',
        actorId,
        semantics: `ACTIVATE:${artifact.profileId}:expected=${expectedVersion ?? 'any'}`,
        version: next.version,
        profileId: artifact.profileId,
        profileHash: artifact.canonicalHash,
        previous: this.stateSnapshotOf(current),
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
   * Reset this game to its accepted default mathematics for NEW paid rounds.
   *
   * Additive and game-agnostic. The pointer move is scoped to exactly this
   * `gameId`, bumps the monotonic revision, and appends an audit row in the same
   * transaction, exactly as activate() does. Nothing here deletes a profile, a
   * validation or a prior activation, and a round already in flight keeps the
   * identity it was opened under because the runtime reads the pointer once.
   *
   * A game whose default is owned by its own admin panel is delegated to that
   * panel's existing transition, so its history and runtime state stay coherent.
   * The registry is the single source of truth for which games have mathematics
   * integrated: an unregistered game is the established 404 contract.
   *
   * The state is decided by the pointer's kind and profile row, never by an RTP
   * value, so a zero-return custom profile is CUSTOM (control on), not DEFAULT.
   */
  async resetToDefault(
    actorId: string,
    gameId: string,
    input: { actionId?: string; expectedVersion?: number } = {},
  ): Promise<GameMathDefaultResult> {
    await this.assertAdmin(actorId, 'CASINO_MATH_DEFAULT');
    // Unknown/integrated-only game: the registry throws the established
    // GAME_MATH_NOT_INTEGRATED 404. Never a silent fallback.
    const adapter = this.registry.adapter(gameId);

    const delegate = (this.defaultResetters ?? []).find((entry) => entry.gameId === gameId);
    if (delegate) {
      const actionId = (input.actionId ?? '').trim();
      return delegate.resetToDefault(actorId, {
        actionId: actionId.length > 0 ? actionId : `math-default-${gameId}-${randomUUID()}`,
        expectedVersion: input.expectedVersion,
      });
    }
    // The registered default this game falls back to, from the game's own adapter
    // (Classic: the frozen rtp50.v1 artefact). A game that declares none keeps the
    // empty identity; nothing is ever borrowed from another game.
    const registered = adapter.defaultProfile?.() ?? null;
    const requested = (input.actionId ?? '').trim();
    return this.resetSharedDefault(
      actorId,
      gameId,
      requested.length > 0 ? requested : `math-default-${gameId}-${randomUUID()}`,
      input.expectedVersion,
      registered,
    );
  }

  /** The shared pointer move to DEFAULT, under the same CAS discipline as activate(). */
  private async resetSharedDefault(
    actorId: string,
    gameId: string,
    actionId: string,
    expectedVersion?: number,
    registered: { profileId: string; profileHash: string } | null = null,
  ): Promise<GameMathDefaultResult> {
    const semantics = `DEFAULT:expected=${expectedVersion ?? 'any'}`;
    const pointer = await this.prisma.$transaction(async (tx) => {
      const current = await tx.gameActiveMathProfile.findUnique({ where: { gameId } });
      const defaultProfileId = registered?.profileId ?? '';
      const defaultProfileHash = registered?.profileHash ?? '';

      // The optimistic guard is evaluated before the idempotent early return, so a
      // stale expectedVersion is refused even when the game is already on default.
      if (current && expectedVersion !== undefined && current.version !== expectedVersion) {
        throw new ConflictException({
          code: 'ACTIVE_MATH_PROFILE_CONFLICT',
          message: `Active mathematics moved to version ${current.version}.`,
        });
      }
      if (current && current.kind === 'DEFAULT' && current.profileRowId === null) {
        // Already default: idempotent, no version bump and no duplicate audit row.
        return current;
      }

      if (!current) {
        // Never activated: the game already runs its accepted default. The row is
        // still materialised so the state is visible and the revision anchored.
        const created = await tx.gameActiveMathProfile.create({
          data: {
            gameId,
            profileRowId: null,
            profileId: defaultProfileId,
            profileHash: defaultProfileHash,
            validationId: null,
            kind: 'DEFAULT',
            payoutCandidateId: null,
            version: 1,
            activatedBy: actorId,
          },
        });
        await this.auditDefault(tx, actorId, gameId, { from: 'NEVER_ACTIVATED', version: created.version });
        await this.recordSharedTransition(tx, {
          gameId,
          actionId,
          action: 'DEFAULT',
          actorId,
          semantics,
          version: created.version,
          profileId: null,
          profileHash: null,
          previous: this.stateSnapshotOf(null),
        });
        return created;
      }

      const updated = await tx.gameActiveMathProfile.updateMany({
        where: { gameId, version: current.version },
        data: {
          profileRowId: null,
          profileId: defaultProfileId,
          profileHash: defaultProfileHash,
          validationId: null,
          kind: 'DEFAULT',
          payoutCandidateId: null,
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
      await this.auditDefault(tx, actorId, gameId, {
        from: 'CUSTOM',
        previousProfileId: current.profileId || null,
        previousProfileHash: current.profileHash || null,
        defaultProfileId: registered?.profileId ?? null,
        version: next.version,
      });
      await this.recordSharedTransition(tx, {
        gameId,
        actionId,
        action: 'DEFAULT',
        actorId,
        semantics,
        version: next.version,
        profileId: null,
        profileHash: null,
        previous: this.stateSnapshotOf(current),
      });
      return next;
    });

    return {
      gameId,
      mode: 'DEFAULT' as const,
      version: pointer.version,
      // For a game with a registered default this is that immutable identity, so
      // CURRENT proves which default is live rather than only that a pointer was
      // cleared. A game with no declared default keeps the empty identity.
      profileId: registered?.profileId ?? null,
      profileHash: registered?.profileHash ?? null,
      validationId: null,
      activatedAt: pointer.activatedAt.toISOString(),
      activatedBy: pointer.activatedBy,
      note:
        `The registered default mathematics${registered ? ` (${registered.profileId})` : ''} are live for ` +
        'NEW paid rounds; a round in flight keeps the mathematics it was opened under.',
    };
  }

  /**
   * This game's own immutable lifecycle history, newest first.
   *
   * Only this game's activation, DEFAULT and rollback transitions are returned:
   * they are the game-scoped, append-only lifecycle records, never another
   * game's rows and never a profile list relabelled as history. A game whose
   * lifecycle is owned by its own admin panel records its transitions into the
   * same table, so this reads exactly what that panel's own route reports. An
   * unregistered game is the established GAME_MATH_NOT_INTEGRATED 404.
   */
  async history(actorId: string, gameId: string, limit = 50): Promise<GameMathHistoryView> {
    await this.assertAdmin(actorId, 'CASINO_MATH_HISTORY');
    this.registry.adapter(gameId);
    const rows = await this.prisma.luckyLadyPayoutActivation.findMany({
      where: { gameId, action: { in: [...LIFECYCLE_ACTIONS] } },
      // Monotonic revision is the authoritative order; createdAt can tie.
      orderBy: [{ version: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });
    return { gameId, entries: rows.map((row) => this.historyEntry(row)) };
  }

  /**
   * Roll this game back to the state its most recent transition replaced.
   *
   * The target comes from this game's own recorded history, never from the
   * client, and it is re-validated through exactly the gate activation uses: a
   * historical profile is not exempt from the hash, engine, status or evidence
   * checks. A target on DEFAULT is applied through the game's own registered
   * default mapping. The pointer move, the history row and the audit entry
   * commit in one transaction under the same CAS/advisory discipline the other
   * transitions use, and an exact replay of a completed action id returns the
   * recorded transition instead of moving the pointer a second time.
   */
  async rollback(
    actorId: string,
    gameId: string,
    input: { actionId?: string; expectedVersion?: number } = {},
  ): Promise<GameMathRollbackResult> {
    await this.assertAdmin(actorId, 'CASINO_MATH_ROLLBACK');
    const adapter = this.registry.adapter(gameId);
    const requested = (input.actionId ?? '').trim();
    const actionId = requested.length > 0 ? requested : `math-rollback-${gameId}-${randomUUID()}`;
    const semantics = `ROLLBACK:expected=${input.expectedVersion ?? 'any'}`;

    // A game whose lifecycle is owned by its own admin panel keeps its own
    // transition: the generic route runs that panel's rollback instead of
    // copying its candidate and distribution work.
    const owner = this.lifecycleOwner(gameId);
    if (owner) {
      return owner.rollbackMath(actorId, { actionId, expectedVersion: input.expectedVersion });
    }

    const registered = adapter.defaultProfile?.() ?? null;
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Same per-game lock order the shared config service and the payout panel
      // use (config first), so a concurrent activation cannot interleave.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:config:${gameId}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:math:lifecycle:${gameId}`}))`;

      const existing = await tx.luckyLadyPayoutActivation.findUnique({
        where: { gameId_actionId: { gameId, actionId } },
      });
      if (existing) {
        const recorded = (existing.previous as unknown as { semantics?: string } | null)?.semantics;
        if (recorded !== semantics) {
          throw new ConflictException({
            code: 'GAME_MATH_ACTION_ID_CONFLICT',
            message: 'This action id was already used for a different lifecycle transition.',
          });
        }
        const pointer = await tx.gameActiveMathProfile.findUnique({ where: { gameId } });
        return { replay: true as const, row: existing, pointer, destination: null };
      }

      const current = await tx.gameActiveMathProfile.findUnique({ where: { gameId } });
      if (current && input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
        throw new ConflictException({
          code: 'ACTIVE_MATH_PROFILE_CONFLICT',
          message: `Active mathematics moved to version ${current.version}.`,
        });
      }

      const latest = await tx.luckyLadyPayoutActivation.findFirst({
        where: { gameId, action: { in: [...LIFECYCLE_ACTIONS] } },
        orderBy: [{ version: 'desc' }],
      });
      if (!latest) {
        throw new ConflictException({
          code: 'GAME_MATH_NOTHING_TO_ROLLBACK',
          message: 'There is no earlier mathematics state recorded for this game to roll back to.',
        });
      }
      // The transition that ran last recorded the state it replaced, and that
      // state is the rollback target - never a client id, never another game's.
      const restored = this.previousStateOf(latest);
      const previous = this.stateSnapshotOf(current);

      let destination: {
        kind: 'DEFAULT' | 'GENERATED';
        profileRowId: string | null;
        profileId: string;
        profileHash: string;
        validationId: string | null;
      };
      if (restored.kind === 'DEFAULT' || !restored.profileId) {
        // DEFAULT is the game's own registered default identity, applied exactly
        // as the DEFAULT reset applies it - never a bare cleared pointer.
        destination = {
          kind: 'DEFAULT',
          profileRowId: null,
          profileId: registered?.profileId ?? '',
          profileHash: registered?.profileHash ?? '',
          validationId: null,
        };
      } else {
        const activatable = await this.requireActivatable(tx, gameId, restored.profileId, adapter.identity());
        destination = {
          kind: 'GENERATED',
          profileRowId: activatable.row.id,
          profileId: activatable.artifact.profileId,
          profileHash: activatable.artifact.canonicalHash,
          validationId: activatable.validation.id,
        };
      }

      const updated = await this.writeSharedPointer(tx, gameId, actorId, destination, current);
      const row = await this.recordSharedTransition(tx, {
        gameId,
        actionId,
        action: 'ROLLBACK',
        actorId,
        semantics,
        version: updated.version,
        profileId: destination.kind === 'GENERATED' ? destination.profileId : null,
        profileHash: destination.kind === 'GENERATED' ? destination.profileHash : null,
        previous,
        target: restored,
      });
      await this.auditLifecycle(tx, actorId, gameId, {
        action: 'ROLLBACK',
        actionId,
        semantics,
        version: updated.version,
        previous,
        target: restored,
      });
      return { replay: false as const, row, pointer: updated, destination };
    });

    // The shared path always records its row; the delegate returns its own.
    if (!outcome.row) {
      throw new InternalServerErrorException({
        code: 'MATH_ROLLBACK_NOT_RECORDED',
        message: 'The rollback produced no history row.',
      });
    }
    return this.rollbackResult(gameId, outcome.row, outcome.pointer, outcome.replay, outcome.destination);
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

  /** The registered owner of this game's lifecycle, when a panel owns it. */
  private lifecycleOwner(gameId: string): GameMathLifecycleOwner | undefined {
    return (this.lifecycleOwners ?? []).find((owner) => owner.gameId === gameId);
  }

  /**
   * The activation gate, evaluated inside the transaction that moves a pointer.
   *
   * Activation and a rollback that restores an earlier profile both run through
   * this one gate: the stored profile, its canonical hash, the evaluator this
   * process runs, its passing validation, the evidence checks its own ceiling
   * scope requires, and the gamble-scope decision. A historical target is not
   * exempt from any of them.
   */
  private async requireActivatable(
    tx: Prisma.TransactionClient,
    gameId: string,
    profileId: string,
    engine: { engineSha256: string; rulesSha256: string },
  ) {
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
    const missing = requiredActivationChecks(artifact.policy.maxWinScope)
      .filter((id) => !checks.some((entry) => entry.id === id));
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

    return { row, artifact, validation, grade };
  }

  /** The state a pointer is in, as a transition snapshot records it. */
  private stateSnapshotOf(
    current: { kind: string; profileRowId: string | null; profileId: string; version: number } | null,
  ): LifecycleSnapshot {
    const custom = current !== null && current.kind !== 'DEFAULT' && current.profileRowId !== null;
    return {
      mode: custom ? 'CUSTOM' : 'DEFAULT',
      version: current?.version ?? 0,
      profileId: custom ? current.profileId : null,
    };
  }

  /** A recorded snapshot, in the shared `GameMathStateRef` shape. */
  private stateRefOf(
    recorded: { mode?: string; version?: number; profileId?: string | null } | null | undefined,
  ): GameMathStateRef {
    return {
      kind: recorded?.mode === 'CUSTOM' ? 'GENERATED' : 'DEFAULT',
      version: typeof recorded?.version === 'number' ? recorded.version : 0,
      profileId: typeof recorded?.profileId === 'string' && recorded.profileId.length > 0 ? recorded.profileId : null,
    };
  }

  /** The state a recorded transition replaced. */
  private previousStateOf(row: LifecycleRow): GameMathStateRef {
    return this.stateRefOf((row.previous ?? null) as { mode?: string; version?: number; profileId?: string | null } | null);
  }

  /**
   * Append the shared lifecycle's own history row for a transition.
   *
   * A game whose lifecycle is owned by a panel keeps that panel's append-only
   * history and its own transition (the generic route delegates), so the shared
   * writer steps aside rather than interleaving a second dialect into it.
   */
  private async recordSharedTransition(
    tx: Prisma.TransactionClient,
    input: {
      gameId: string;
      actionId: string;
      action: 'ACTIVATE' | 'ROLLBACK' | 'DEFAULT';
      actorId: string;
      semantics: string;
      version: number;
      profileId: string | null;
      profileHash: string | null;
      previous: LifecycleSnapshot;
      target?: GameMathStateRef | null;
    },
  ): Promise<LifecycleRow | null> {
    if (this.lifecycleOwner(input.gameId)) return null;
    try {
      return await tx.luckyLadyPayoutActivation.create({
        data: {
          gameId: input.gameId,
          actionId: input.actionId,
          action: input.action,
          candidateRowId: null,
          candidateId: null,
          modelProfileId: input.profileId,
          policyHash: null,
          modelHash: input.profileHash,
          targetRtpPercent: null,
          maxWinMultiplier: null,
          style: null,
          version: input.version,
          // The panel's own free-form snapshot shape, plus the state a rollback
          // restored. No payout candidate or distribution id is ever invented
          // for a shared transition: those columns stay null.
          previous: {
            semantics: input.semantics,
            mode: input.previous.mode,
            version: input.previous.version,
            profileId: input.previous.profileId,
            candidateId: null,
            policyId: null,
            targetRtpPercent: null,
            ...(input.target
              ? {
                  target: {
                    mode: input.target.kind === 'GENERATED' ? 'CUSTOM' : 'DEFAULT',
                    version: input.target.version,
                    profileId: input.target.profileId,
                  },
                }
              : {}),
          } as unknown as Prisma.InputJsonValue,
          actorId: input.actorId,
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'GAME_MATH_ACTION_ID_CONFLICT',
          message: 'This action id was already used for a lifecycle transition of this game.',
        });
      }
      throw error;
    }
  }

  /** Move the shared pointer to a destination state under the same CAS guard. */
  private async writeSharedPointer(
    tx: Prisma.TransactionClient,
    gameId: string,
    actorId: string,
    destination: {
      kind: 'DEFAULT' | 'GENERATED';
      profileRowId: string | null;
      profileId: string;
      profileHash: string;
      validationId: string | null;
    },
    current: { version: number } | null,
  ) {
    if (!current) {
      return tx.gameActiveMathProfile.create({
        data: {
          gameId,
          profileRowId: destination.profileRowId,
          profileId: destination.profileId,
          profileHash: destination.profileHash,
          validationId: destination.validationId,
          kind: destination.kind,
          payoutCandidateId: null,
          version: 1,
          activatedBy: actorId,
        },
      });
    }
    const updated = await tx.gameActiveMathProfile.updateMany({
      where: { gameId, version: current.version },
      data: {
        profileRowId: destination.profileRowId,
        profileId: destination.profileId,
        profileHash: destination.profileHash,
        validationId: destination.validationId,
        kind: destination.kind,
        payoutCandidateId: null,
        version: current.version + 1,
        activatedBy: actorId,
        activatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'ACTIVE_MATH_PROFILE_CONFLICT',
        message: 'Another transition won the race; reload and retry.',
      });
    }
    return tx.gameActiveMathProfile.findUniqueOrThrow({ where: { gameId } });
  }

  /** One recorded transition, in the shared history shape. */
  private historyEntry(row: LifecycleRow): GameMathHistoryEntry {
    const recorded = (row.previous ?? null) as {
      mode?: string;
      version?: number;
      profileId?: string | null;
      target?: { mode?: string; version?: number; profileId?: string | null } | null;
    } | null;
    return {
      id: row.id,
      actionId: row.actionId,
      action: row.action as GameMathHistoryEntry['action'],
      // The state the transition produced: a row naming a profile or a payout
      // candidate is control ON (kind GENERATED, the semantic CUSTOM state), a
      // row naming neither is the DEFAULT state. The query is scoped to exactly
      // this gameId, so another game's identity can never appear here.
      kind: row.candidateId || row.modelProfileId ? 'GENERATED' : 'DEFAULT',
      version: row.version,
      profileId: row.modelProfileId,
      profileHash: row.modelHash,
      candidateId: row.candidateId,
      actorId: row.actorId,
      createdAt: row.createdAt.toISOString(),
      previous: this.stateRefOf(recorded),
      target: recorded?.target ? this.stateRefOf(recorded.target) : null,
    };
  }

  /** The uniform result of a rollback, wherever the transition ran. */
  private rollbackResult(
    gameId: string,
    row: LifecycleRow,
    pointer: {
      profileId: string;
      validationId: string | null;
      activatedAt: Date;
      activatedBy: string;
    } | null,
    replay: boolean,
    destination: {
      kind: 'DEFAULT' | 'GENERATED';
      profileId: string;
      profileHash: string;
      validationId: string | null;
    } | null,
  ): GameMathRollbackResult {
    // The live transition reports the state it produced - including the game's
    // registered default identity when the target was DEFAULT. A replay reports
    // the recorded row instead, so it never claims a state the row does not hold.
    const kind: 'DEFAULT' | 'GENERATED' = destination
      ? destination.kind
      : row.candidateId || row.modelProfileId
        ? 'GENERATED'
        : 'DEFAULT';
    return {
      gameId,
      action: 'ROLLBACK',
      replay,
      version: row.version,
      kind,
      profileId: destination
        ? destination.profileId.length > 0
          ? destination.profileId
          : null
        : row.modelProfileId,
      profileHash: destination
        ? destination.profileHash.length > 0
          ? destination.profileHash
          : null
        : row.modelHash,
      validationId: destination
        ? destination.validationId
        : kind === 'GENERATED' && pointer?.profileId === row.modelProfileId
          ? pointer.validationId
          : null,
      candidateId: row.candidateId,
      activatedAt: pointer ? pointer.activatedAt.toISOString() : null,
      activatedBy: pointer?.activatedBy ?? row.actorId,
    };
  }

  /** The shared lifecycle audit row commits in the same transaction. */
  private auditLifecycle(
    tx: Prisma.TransactionClient,
    actorId: string,
    gameId: string,
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: gameId,
        // Same established enum value and metadata convention the DEFAULT row
        // uses; a distinct AuditAction value would need a migration.
        action: 'CASINO_MATH_PAYOUT_LIFECYCLE',
        result: 'OK',
        metadata: metadata as Prisma.InputJsonValue,
      },
    });
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

  /** The DEFAULT audit row commits in the same transaction as the pointer move. */
  private auditDefault(
    tx: Prisma.TransactionClient,
    actorId: string,
    gameId: string,
    metadata: Record<string, unknown>,
  ) {
    return tx.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: gameId,
        // `AuditAction` is a database enum, and a distinct
        // `CASINO_MATH_PROFILE_DEFAULT` value would need a migration. The
        // established lifecycle action is reused with the transition spelled out
        // in the metadata, exactly like the payout panel's own DEFAULT rows.
        action: 'CASINO_MATH_PAYOUT_LIFECYCLE',
        result: 'OK',
        metadata: { action: 'DEFAULT', ...metadata } as Prisma.InputJsonValue,
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

/**
 * The activation evidence a profile must carry, by ceiling scope.
 *
 * `RTP_WITHIN_BOUND_TIMES_HIT_RATE` is the whole-round identity
 * `E[X] <= M * P(X > 0)`: it only holds when one paid round resolves to at most
 * one bounded outcome. A `RESOLVED_SPIN` profile deliberately bounds each paid
 * and free resolution while a feature chain may aggregate many of them, so the
 * identity is not asserted there - the game adapters state the same rule. Requiring
 * it for `RESOLVED_SPIN` made activation impossible for exactly the grammar that
 * proves a per-resolution ceiling, while the per-resolution ceiling itself is
 * still proved by `MAX_WIN_PROVEN_WITHIN_CEILING`. Whole-round scopes keep the
 * complete list, so their gate is unchanged.
 */
export function requiredActivationChecks(scope: string): readonly string[] {
  return scope === 'RESOLVED_SPIN'
    ? REQUIRED_ACTIVATION_CHECKS.filter((id) => id !== 'RTP_WITHIN_BOUND_TIMES_HIT_RATE')
    : [...REQUIRED_ACTIVATION_CHECKS];
}

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
