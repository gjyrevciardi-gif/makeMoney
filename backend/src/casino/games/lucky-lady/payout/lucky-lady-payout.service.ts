import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import { join } from 'node:path';
import { PrismaService } from '../../../../prisma.service';
import { hasCapability } from '../../../../auth/capabilities';
import { canonicalProfileHash } from '../../../platform/math-control/math-control.analytics';
import { MathControlJobs } from '../../../platform/math-control/math-control.jobs';
import {
  DISTRIBUTION_CLASSES,
  distributionPolicyHash,
  validateDistributionPolicy,
  type DistributionPolicy,
} from '../../../platform/math-control/payout-distribution';
import type { PolicyBankrollReport } from '../../../platform/math-control/payout-policy-bankroll';
import type { MathPolicy, MathProfileArtifact } from '../../../platform/math-control/math-control.types';
import { assertGambleScopeResolved } from '../../../platform/math-control/math-control.service';
import { luckyLadyGeneratorModel } from '../lucky-lady.policy-generator';
import { LUCKY_LADY_V1 } from '../lucky-lady.definition';
import { loadVerifiedMath } from '../lucky-lady.math';
import { runLuckyLadyPayoutWork } from './lucky-lady-payout.work';
import {
  LUCKY_LADY_PAYOUT_GAME_ID,
  LUCKY_LADY_PAYOUT_STYLES,
  LUCKY_LADY_PAYOUT_SUPPORTED_MAX_WIN,
  type LifecycleAction,
  type LuckyLadyPayoutStyle,
  type PayoutActivationResult,
  type PayoutActiveState,
  type PayoutCandidateView,
  type PayoutClassWeight,
  type PayoutCurrentView,
  type PayoutHistoryEntry,
  type PayoutPreviewView,
  type PayoutReportMetrics,
  type StoredDistribution,
} from './lucky-lady-payout.types';

/**
 * The admin RTP Control lifecycle for Lucky Lady's generated payout policy.
 *
 * This is deliberately separate from the legacy `MathControlService`
 * generate/validate/activate flow: the accepted game-specific generator
 * (`generateLuckyLadyPolicy` + `runGeneratedPolicyEvidence`) produces a declared
 * bounded *model artifact* and a solved *class-distribution policy*, whose
 * runtime behaviour is the model weighting selecting real boards through the
 * stored distribution. The two identities are frozen together on one candidate
 * row and activated in one transaction that also writes the matching game
 * distribution version.
 *
 * The active identity is the pointer's `payoutCandidateId`, never a guess from
 * a shared model hash, so two candidates built on the same model can be
 * activated in turn and always resolve to the exact one that is live.
 *
 * The service owns the security boundary and nothing else:
 *   - every read and every mutation re-checks the ADMIN role in the database;
 *   - the actor id always comes from the authenticated request, never a body;
 *   - generation input is a bounded, whitelisted request (no player fields);
 *   - the report is produced by the accepted simulator and stored server-side;
 *   - activation requires a stored VALIDATED candidate whose frozen hashes are
 *     re-derived, and moves the pointer under advisory locks with CAS;
 *   - every transition appends one history row and one audit row in the same
 *     transaction as the pointer move, with the previous state recorded;
 *   - a repeated action id is resolved inside the lock and returns the stored
 *     transition, so a double click can never duplicate or conflict.
 */
@Injectable()
export class LuckyLadyPayoutService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: MathControlJobs,
  ) {}

  // -------------------------------------------------------------------------
  // Security boundary
  // -------------------------------------------------------------------------

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

  // -------------------------------------------------------------------------
  // Current / history
  // -------------------------------------------------------------------------

  async current(actorId: string): Promise<PayoutCurrentView> {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_CURRENT');
    return this.currentUnchecked();
  }

  private async currentUnchecked(): Promise<PayoutCurrentView> {
    const [pointer, candidateCount, golden] = await Promise.all([
      this.prisma.gameActiveMathProfile.findUnique({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      this.prisma.luckyLadyPayoutCandidate.count({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      this.goldenDefault(),
    ]);

    let active: PayoutActiveState;
    if (!pointer || pointer.kind === 'DEFAULT' || pointer.profileRowId === null) {
      active = this.defaultActiveState(pointer?.version ?? 0, pointer?.activatedAt ?? null, pointer?.activatedBy ?? null);
    } else if (pointer.payoutCandidateId) {
      const candidate = await this.prisma.luckyLadyPayoutCandidate.findUnique({
        where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: pointer.payoutCandidateId } },
      });
      active = {
        mode: 'CUSTOM',
        legacy: false,
        version: pointer.version,
        profileId: pointer.profileId,
        profileHash: pointer.profileHash,
        validationId: pointer.validationId,
        policyId: candidate ? (candidate.distributionPolicy as unknown as StoredShape).policyId ?? null : null,
        policyHash: candidate ? candidate.policyHash : null,
        modelId: pointer.profileId,
        modelHash: pointer.profileHash,
        targetRtpPercent: candidate ? Number(candidate.targetRtpPercent) : null,
        maxWinMultiplier: candidate ? candidate.maxWinMultiplier : null,
        style: candidate ? candidate.style : null,
        activatedAt: pointer.activatedAt.toISOString(),
        activatedBy: pointer.activatedBy,
        note: 'The active policy applies to NEW paid rounds only; a round in flight keeps the mathematics it was opened under.',
      };
    } else {
      // Activated by the shared math lifecycle, not the payout panel. Reported
      // honestly rather than guessed at from a model hash.
      active = {
        mode: 'CUSTOM',
        legacy: true,
        version: pointer.version,
        profileId: pointer.profileId,
        profileHash: pointer.profileHash,
        validationId: pointer.validationId,
        policyId: null,
        policyHash: null,
        modelId: pointer.profileId,
        modelHash: pointer.profileHash,
        targetRtpPercent: null,
        maxWinMultiplier: null,
        style: null,
        activatedAt: pointer.activatedAt.toISOString(),
        activatedBy: pointer.activatedBy,
        note:
          'This mathematics was activated by the shared Game Math Control lifecycle, not the payout panel, ' +
          'so no payout policy is recorded. Activating or defaulting here replaces it for NEW paid rounds.',
      };
    }

    return {
      gameId: LUCKY_LADY_PAYOUT_GAME_ID,
      active,
      defaultProfile: golden,
      candidateCount,
    };
  }

  async history(actorId: string, limit = 50): Promise<{ gameId: string; entries: PayoutHistoryEntry[] }> {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_HISTORY');
    const rows = await this.prisma.luckyLadyPayoutActivation.findMany({
      where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
      // Monotonic revision is the authoritative order; createdAt can tie.
      orderBy: [{ version: 'desc' }],
      take: Math.min(Math.max(limit, 1), 200),
    });
    return {
      gameId: LUCKY_LADY_PAYOUT_GAME_ID,
      entries: rows.map((row) => ({
        id: row.id,
        actionId: row.actionId,
        action: row.action,
        version: row.version,
        candidateId: row.candidateId,
        profileId: row.modelProfileId,
        policyHash: row.policyHash,
        modelHash: row.modelHash,
        targetRtpPercent: row.targetRtpPercent === null ? null : Number(row.targetRtpPercent),
        maxWinMultiplier: row.maxWinMultiplier,
        style: row.style,
        previous: row.previous as unknown as PayoutHistoryEntry['previous'],
        actorId: row.actorId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // Generate / preview
  // -------------------------------------------------------------------------

  async generate(actorId: string, raw: Record<string, unknown>) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_GENERATE');
    const request = this.normalizeRequest(raw);

    const work = await this.jobs.enqueue<ReturnType<typeof runLuckyLadyPayoutWork>>(
      {
        kind: 'PAYOUT',
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        actorId,
        worker: {
          kind: 'PAYOUT',
          modulePath: join(__dirname, 'lucky-lady-payout.work.js'),
          exportName: 'runLuckyLadyPayoutWork',
          request,
        },
        workerPath: join(__dirname, 'lucky-lady-payout.worker.js'),
      },
      async () => runLuckyLadyPayoutWork(request),
    );
    const { candidate, report } = work.result;

    if (!candidate.policy || !candidate.model || !candidate.policyHash) {
      return this.unsolvedOutcome(candidate.status, candidate.reasons, candidate.stages);
    }

    const policyHash = candidate.policyHash;
    const modelHash = candidate.model.modelHash;
    const distribution = candidate.policy;
    if (!distribution) {
      throw new InternalServerErrorException({
        code: 'PAYOUT_DISTRIBUTION_MISSING',
        message: 'The generator solved a policy without a distribution.',
      });
    }
    if (distributionPolicyHash(distribution) !== policyHash) {
      throw new InternalServerErrorException({
        code: 'PAYOUT_DISTRIBUTION_HASH_MISMATCH',
        message: 'The solved distribution does not match the reported policy hash.',
      });
    }
    const artifact = this.modelArtifactFromCandidate(candidate);

    const candidateId = candidate.policyId ?? `lucky-lady.payout.${policyHash.slice(0, 12)}`;
    const targetRtpPercent = Number(
      (candidate.request.normalized?.targetRtpPercent ?? raw.targetRtpPercent ?? '0') as string | number,
    );
    const style = this.styleOf(candidate.request.normalized?.objective);
    const declaredReturnPercent = Number(candidate.model.declaredReturnPercent.toFixed(6));
    const maxWinMultiplier = candidate.model.maxWinMultiplier;
    const metrics = this.metricsFromReport(report, { targetRtpPercent, declaredReturnPercent, policyHash, artifact });

    const storedReport = report as unknown as Record<string, unknown>;
    const storedDistribution = this.storedDistribution(distribution);

    const row = await this.prisma.luckyLadyPayoutCandidate.upsert({
      where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId } },
      create: {
        gameId: LUCKY_LADY_PAYOUT_GAME_ID,
        candidateId,
        requestHash: candidate.requestHash,
        policyHash,
        modelHash,
        modelProfileId: candidate.model.modelId,
        declaredReturnPercent: new Prisma.Decimal(declaredReturnPercent.toFixed(4)),
        targetRtpPercent: new Prisma.Decimal(targetRtpPercent.toFixed(4)),
        maxWinMultiplier,
        style,
        request: {
          raw: candidate.request.raw,
          normalized: candidate.request.normalized,
          appliedFloors: candidate.request.appliedFloors,
        } as unknown as Prisma.InputJsonValue,
        distributionPolicy: distribution as unknown as Prisma.InputJsonValue,
        modelArtifact: artifact as unknown as Prisma.InputJsonValue,
        createdBy: actorId,
      },
      update: {},
    });

    let validation = await this.latestValidation(row.id);
    if (!validation) {
      const path = this.evidencePath(candidateId, policyHash);
      validation = await this.prisma.luckyLadyPayoutValidation.create({
        data: {
          candidateRowId: row.id,
          gameId: LUCKY_LADY_PAYOUT_GAME_ID,
          candidateId,
          policyHash,
          modelHash,
          status: report.status,
          verdict: report.statistical?.verdict ?? 'NOT_RUN',
          report: storedReport as unknown as Prisma.InputJsonValue,
          metrics: metrics as unknown as Prisma.InputJsonValue,
          artifactPath: path,
          validatedBy: actorId,
        },
      });
      await this.audit(actorId, 'GENERATE', {
        candidateId,
        policyHash,
        modelHash,
        status: report.status,
        verdict: report.statistical?.verdict ?? 'NOT_RUN',
        targetRtpPercent,
        maxWinMultiplier,
        style,
      });
    }

    const view = this.candidateView(row, storedDistribution, candidate.reasons, candidate.stages);
    if (report.status === 'VALIDATED' && validation.status === 'VALIDATED') {
      return { status: 'VALIDATED' as const, candidate: view, metrics };
    }
    if (report.status === 'VALIDATED') {
      // The stored row already exists with a non-VALIDATED status.
      return this.unsolvedOutcome(validation.status, candidate.reasons, candidate.stages, view, metrics);
    }
    return this.unsolvedOutcome(report.status, candidate.reasons, candidate.stages, view, metrics);
  }

  async preview(actorId: string, candidateId: string): Promise<PayoutPreviewView> {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_PREVIEW');
    const row = await this.loadCandidate(candidateId);
    const validation = await this.latestValidation(row.id);
    if (!validation) {
      throw new NotFoundException({
        code: 'PAYOUT_CANDIDATE_NOT_VALIDATED',
        message: 'This candidate has no stored evidence report.',
      });
    }
    const report = validation.report as unknown as PayoutPreviewView['report'];
    const hashMatches = validation.policyHash === row.policyHash && validation.modelHash === row.modelHash;
    const status = hashMatches ? validation.status : 'REJECTED';
    const reasons = hashMatches
      ? ((report.generator?.reasons ?? []) as PayoutCandidateView['reasons'])
      : [{
          constraint: 'EVIDENCE_HASH_MISMATCH',
          requested: 'stored evidence for this candidate',
          achievable: 'matching policy and model hashes',
          detail: 'The stored report hashes do not match the candidate; the report is not shown as valid.',
        }];
    return {
      candidate: {
        ...this.candidateView(row, this.storedDistributionFromRow(row), reasons, (report.generator?.stages ?? []) as PayoutCandidateView['stages']),
        status,
      },
      report,
      metrics: (validation.metrics as unknown as PayoutReportMetrics) ?? null,
      artifactPath: validation.artifactPath,
    };
  }

  async candidates(actorId: string) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_CANDIDATES');
    const [rows, pointer] = await Promise.all([
      this.prisma.luckyLadyPayoutCandidate.findMany({
        where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
        orderBy: [{ createdAt: 'desc' }],
        include: { validations: { orderBy: [{ createdAt: 'desc' }], take: 1 } },
      }),
      this.prisma.gameActiveMathProfile.findUnique({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
    ]);
    return {
      gameId: LUCKY_LADY_PAYOUT_GAME_ID,
      candidates: rows.map((row) => {
        const view = this.candidateView(row, this.storedDistributionFromRow(row), [], []);
        const validation = row.validations[0];
        return {
          ...view,
          status: validation?.status ?? view.status,
          activated: pointer?.payoutCandidateId === row.candidateId,
        };
      }),
    };
  }

  reportForStorage(report: import('../lucky-lady.policy-generator').GeneratedPolicyReport) {
    return report as unknown as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------
  // Runtime seam: one frozen snapshot for a NEW paid round
  // -------------------------------------------------------------------------

  /**
   * The single authoritative snapshot the runtime reads for a NEW paid round
   * including an explicit accepted DEFAULT and pre-panel activations.
   *
   * The pointer names the exact candidate; the candidate row is immutable and
   * carries the model artifact and the solved distribution together, so the
   * model weighting and the class distribution always belong to the same
   * activation. Nothing here is read from a request.
   */
  async activePayoutSnapshot(gameId: string): Promise<ActivePayoutSnapshot> {
    if (gameId !== LUCKY_LADY_PAYOUT_GAME_ID) throw new BadRequestException('PAYOUT_GAME_UNSUPPORTED');
    // The first SELECT establishes the snapshot's linearization point. All
    // supporting reads see that same committed state, including legacy config.
    // DEFAULT is a complete answer, never an instruction to read another source.
    return this.prisma.$transaction(async (tx) => {
      const pointer = await tx.gameActiveMathProfile.findUnique({ where: { gameId } });
      if (!pointer || pointer.kind === 'DEFAULT' || pointer.profileRowId === null) {
        const { profile, hashes } = loadVerifiedMath();
        return {
          mode: 'DEFAULT' as const,
          version: pointer?.version ?? 0,
          validationId: null,
          candidateId: null,
          profileId: profile.id,
          profileHash: hashes.profileCanonicalHash,
          engineSha256: hashes.engineSha256,
          rulesSha256: hashes.rulesSha256,
          modelPayload: profile,
          policy: null,
          targetRtpPercent: profile.targetRtpPercent,
          policyId: null,
          policyHash: null,
          distributionPolicy: null,
        };
      }
      // Preserve pre-panel activations, resolving their model and optional
      // distribution in this transaction rather than falling back in the adapter.
      if (!pointer.payoutCandidateId) {
        const row = await tx.gameMathProfile.findUnique({ where: { id: pointer.profileRowId } });
        if (!row) throw new InternalServerErrorException('MATH_ACTIVE_PROFILE_MISSING');
        const artifact: MathProfileArtifact = {
          schemaVersion: 1, profileId: row.profileId, gameId: row.gameId,
          engineSha256: row.engineSha256, rulesSha256: row.rulesSha256,
          policy: row.policy as unknown as MathPolicy, payload: row.payload,
          canonicalHash: row.canonicalHash, createdAt: row.createdAt.toISOString(),
        };
        if (canonicalProfileHash(artifact) !== pointer.profileHash || row.canonicalHash !== pointer.profileHash || row.profileId !== pointer.profileId) {
          throw new InternalServerErrorException('MATH_ARTIFACT_HASH_MISMATCH');
        }
        const config = await tx.casinoGameConfig.findUnique({ where: { gameId }, include: { activeVersion: true } });
        const specific = config?.activeVersion?.gameSpecificConfig as Record<string, unknown> | undefined;
        let distribution: DistributionPolicy | null = null;
        if (specific?.distributionPolicy != null) {
          const checked = validateDistributionPolicy(specific.distributionPolicy);
          if (!checked.ok) throw new InternalServerErrorException('DISTRIBUTION_POLICY_INVALID');
          distribution = checked.policy;
          if (specific.distributionPolicyHash !== undefined && specific.distributionPolicyHash !== distributionPolicyHash(distribution)) {
            throw new InternalServerErrorException('DISTRIBUTION_POLICY_HASH_MISMATCH');
          }
        }
        return {
          mode: 'CUSTOM' as const, version: pointer.version, validationId: pointer.validationId,
          candidateId: null, profileId: artifact.profileId, profileHash: artifact.canonicalHash,
          engineSha256: artifact.engineSha256, rulesSha256: artifact.rulesSha256,
          modelPayload: artifact.payload, policy: artifact.policy,
          targetRtpPercent: artifact.policy.targetRtpPercent,
          policyId: distribution?.policyId ?? null,
          policyHash: distribution ? distributionPolicyHash(distribution) : null,
          distributionPolicy: distribution,
        };
      }
      const candidate = await tx.luckyLadyPayoutCandidate.findUnique({
        where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: pointer.payoutCandidateId } },
      });
      if (!candidate) {
        throw new InternalServerErrorException({
          code: 'PAYOUT_ACTIVE_CANDIDATE_MISSING',
          message: 'The active payout pointer references a missing candidate.',
        });
      }
      // Re-derive both frozen identities; a tampered row fails closed.
      const { artifact, distribution } = this.frozenIdentity(candidate);
      if (artifact.canonicalHash !== pointer.profileHash || artifact.profileId !== pointer.profileId) {
        throw new InternalServerErrorException({
          code: 'PAYOUT_ACTIVE_POINTER_MISMATCH',
          message: 'The active pointer does not match its candidate.',
        });
      }
      return {
        mode: 'CUSTOM' as const,
        version: pointer.version,
        validationId: pointer.validationId,
        candidateId: candidate.candidateId,
        profileId: artifact.profileId,
        profileHash: artifact.canonicalHash,
        engineSha256: artifact.engineSha256,
        rulesSha256: artifact.rulesSha256,
        modelPayload: artifact.payload,
        policy: artifact.policy,
        targetRtpPercent: Number(candidate.targetRtpPercent),
        policyId: distribution.policyId,
        policyHash: candidate.policyHash,
        distributionPolicy: distribution,
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  // -------------------------------------------------------------------------
  // Activate / rollback / default
  // -------------------------------------------------------------------------

  async activate(actorId: string, candidateId: string, input: { actionId: string; expectedVersion?: number }) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_ACTIVATE');
    const actionId = this.requireActionId(input.actionId);
    const semantics = `ACTIVATE:${candidateId}:expected=${input.expectedVersion ?? 'any'}`;

    return this.transition(actorId, {
      actionId,
      semantics,
      action: 'ACTIVATE',
      run: async (tx, current) => {
        if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
          throw new ConflictException({
            code: 'PAYOUT_ACTIVE_CONFLICT',
            message: `Active mathematics moved to version ${current.version}.`,
            expectedVersion: input.expectedVersion,
            actualVersion: current.version,
          });
        }
        const row = await this.loadCandidate(candidateId, tx);
        const validation = await this.latestValidation(row.id, tx);
        if (!validation || validation.status !== 'VALIDATED' || validation.verdict !== 'PASS') {
          throw new ConflictException({
            code: 'PAYOUT_CANDIDATE_NOT_VALIDATED',
            message: 'Only a candidate with a completed, acceptable evidence report can be activated.',
            status: validation?.status ?? 'MISSING',
            verdict: validation?.verdict ?? 'MISSING',
          });
        }
        if (validation.policyHash !== row.policyHash || validation.modelHash !== row.modelHash) {
          throw new ConflictException({
            code: 'PAYOUT_EVIDENCE_HASH_MISMATCH',
            message: 'The stored evidence does not match the candidate it would activate.',
          });
        }
        const { artifact, distribution } = this.frozenIdentity(row);
        this.assertActivationCap(row.maxWinMultiplier);
        const modelProfileId = await this.ensureModelProfile(tx, actorId, artifact);

        const updated = await this.movePointer(tx, {
          actorId,
          kind: 'GENERATED',
          profileRowId: modelProfileId,
          profileId: row.modelProfileId,
          profileHash: row.modelHash,
          validationId: validation.id,
          payoutCandidateId: row.candidateId,
          expectedVersion: input.expectedVersion,
        });
        await this.writeDistributionVersion(tx, actorId, row, distribution);
        return {
          mode: 'CUSTOM' as const,
          candidateId: row.candidateId,
          profileId: row.modelProfileId,
          policyId: distribution.policyId,
          policyHash: row.policyHash,
          modelHash: row.modelHash,
          targetRtpPercent: Number(row.targetRtpPercent),
          maxWinMultiplier: row.maxWinMultiplier,
          style: row.style,
          version: updated.version,
        };
      },
    });
  }

  async rollback(actorId: string, input: { actionId: string; expectedVersion?: number }) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_ROLLBACK');
    const actionId = this.requireActionId(input.actionId);
    const semantics = `ROLLBACK:expected=${input.expectedVersion ?? 'any'}`;

    return this.transition(actorId, {
      actionId,
      semantics,
      action: 'ROLLBACK',
      run: async (tx, current) => {
        if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
          throw new ConflictException({
            code: 'PAYOUT_ACTIVE_CONFLICT',
            message: `Active mathematics moved to version ${current.version}.`,
          });
        }
        const rows = await tx.luckyLadyPayoutActivation.findMany({
          where: {
            gameId: LUCKY_LADY_PAYOUT_GAME_ID,
            action: { in: ['ACTIVATE', 'ROLLBACK', 'DEFAULT'] },
          },
          orderBy: [{ version: 'desc' }],
          take: 1,
        });
        if (rows.length === 0) {
          throw new ConflictException({
            code: 'PAYOUT_NOTHING_TO_ROLLBACK',
            message: 'There is no previous payout state to roll back to.',
          });
        }
        // Rollback restores the state the most recent transition replaced, which
        // that transition recorded as its own `previous` snapshot. The action and
        // the target both come from the append-only history, never the client.
        const target = rows[0].previous as unknown as PayoutHistoryEntry['previous'];
        if (target.mode === 'DEFAULT' || !target.candidateId) {
          const updated = await this.movePointer(tx, {
            actorId,
            kind: 'DEFAULT',
            profileRowId: null,
            profileId: '',
            profileHash: '',
            validationId: null,
            payoutCandidateId: null,
            expectedVersion: input.expectedVersion,
          });
          await this.clearDistributionVersion(tx, actorId);
          return {
            mode: 'DEFAULT' as const,
            candidateId: null,
            profileId: null,
            policyId: null,
            policyHash: null,
            modelHash: null,
            targetRtpPercent: null,
            maxWinMultiplier: null,
            style: null,
            version: updated.version,
          };
        }
        const previous = await tx.luckyLadyPayoutCandidate.findUnique({
          where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: target.candidateId } },
        });
        if (!previous) {
          throw new ConflictException({
            code: 'PAYOUT_ROLLBACK_TARGET_MISSING',
            message: 'The recorded previous policy is no longer present.',
          });
        }
        const previousValidation = await this.latestValidation(previous.id, tx);
        if (!previousValidation || previousValidation.status !== 'VALIDATED') {
          throw new ConflictException({
            code: 'PAYOUT_ROLLBACK_EVIDENCE_MISSING',
            message: 'The recorded previous policy has no valid stored evidence to activate against.',
          });
        }
        this.assertActivationCap(previous.maxWinMultiplier);
        const { artifact, distribution } = this.frozenIdentity(previous);
        const modelProfileId = await this.ensureModelProfile(tx, actorId, artifact);
        const updated = await this.movePointer(tx, {
          actorId,
          kind: 'GENERATED',
          profileRowId: modelProfileId,
          profileId: previous.modelProfileId,
          profileHash: previous.modelHash,
          validationId: previousValidation.id,
          payoutCandidateId: previous.candidateId,
          expectedVersion: input.expectedVersion,
        });
        await this.writeDistributionVersion(tx, actorId, previous, distribution);
        return {
          mode: 'CUSTOM' as const,
          candidateId: previous.candidateId,
          profileId: previous.modelProfileId,
          policyId: distribution.policyId,
          policyHash: previous.policyHash,
          modelHash: previous.modelHash,
          targetRtpPercent: Number(previous.targetRtpPercent),
          maxWinMultiplier: previous.maxWinMultiplier,
          style: previous.style,
          version: updated.version,
        };
      },
    });
  }

  async restoreDefault(actorId: string, input: { actionId: string; expectedVersion?: number }) {
    await this.assertAdmin(actorId, 'CASINO_MATH_PAYOUT_DEFAULT');
    const actionId = this.requireActionId(input.actionId);
    const semantics = `DEFAULT:expected=${input.expectedVersion ?? 'any'}`;

    return this.transition(actorId, {
      actionId,
      semantics,
      action: 'DEFAULT',
      run: async (tx, current) => {
        if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
          throw new ConflictException({
            code: 'PAYOUT_ACTIVE_CONFLICT',
            message: `Active mathematics moved to version ${current.version}.`,
          });
        }
        const updated = await this.movePointer(tx, {
          actorId,
          kind: 'DEFAULT',
          profileRowId: null,
          profileId: '',
          profileHash: '',
          validationId: null,
          payoutCandidateId: null,
          expectedVersion: input.expectedVersion,
        });
        // Default must not delete candidates or history; it clears the runtime
        // distribution so NEW rounds use the golden RTP50 mathematics.
        await this.clearDistributionVersion(tx, actorId);
        return {
          mode: 'DEFAULT' as const,
          candidateId: null,
          profileId: null,
          policyId: null,
          policyHash: null,
          modelHash: null,
          targetRtpPercent: null,
          maxWinMultiplier: null,
          style: null,
          version: updated.version,
        };
      },
    });
  }

  // -------------------------------------------------------------------------
  // Transition machinery
  // -------------------------------------------------------------------------

  private async transition(
    actorId: string,
    input: {
      actionId: string;
      semantics: string;
      action: LifecycleAction;
      run: (tx: Prisma.TransactionClient, current: { mode: 'DEFAULT' | 'CUSTOM'; version: number }) => Promise<TransitionOutcome>;
    },
  ): Promise<PayoutActivationResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      // Serialise every payout transition per game on the same lock the shared
      // config service uses, then a payout-specific lock. Always in this order so
      // a concurrent shared config activation cannot deadlock against us.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:config:${LUCKY_LADY_PAYOUT_GAME_ID}`}))`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:math:payout:${LUCKY_LADY_PAYOUT_GAME_ID}`}))`;

      // Replay / conflict is resolved INSIDE the lock, so a concurrent identical
      // action id succeeds as a replay instead of racing the unique index.
      const existing = await tx.luckyLadyPayoutActivation.findUnique({
        where: { gameId_actionId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, actionId: input.actionId } },
      });
      if (existing) {
        const recorded = (existing.previous as unknown as { semantics?: string }).semantics;
        if (recorded !== input.semantics) {
          throw new ConflictException({
            code: 'PAYOUT_ACTION_ID_CONFLICT',
            message: 'This action id was already used for a different payout transition.',
          });
        }
        return { kind: 'replay' as const, row: existing };
      }

      const currentRow = await tx.gameActiveMathProfile.findUnique({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } });
      const current: { mode: 'DEFAULT' | 'CUSTOM'; version: number } = {
        mode: currentRow && currentRow.profileRowId !== null && currentRow.kind !== 'DEFAULT' ? 'CUSTOM' : 'DEFAULT',
        version: currentRow?.version ?? 0,
      };
      const previousSnapshot: PayoutHistoryEntry['previous'] & { semantics: string } = {
        semantics: input.semantics,
        mode: current.mode,
        version: current.version,
        profileId: currentRow?.profileRowId ? currentRow.profileId : null,
        candidateId: currentRow?.payoutCandidateId ?? null,
        policyId: null,
        targetRtpPercent: null,
      };
      if (currentRow?.payoutCandidateId) {
        const previousCandidate = await tx.luckyLadyPayoutCandidate.findUnique({
          where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: currentRow.payoutCandidateId } },
        });
        if (previousCandidate) {
          previousSnapshot.policyId = (previousCandidate.distributionPolicy as unknown as StoredShape).policyId ?? null;
          previousSnapshot.targetRtpPercent = Number(previousCandidate.targetRtpPercent);
        }
      }

      const result = await input.run(tx, current);
      const row = await tx.luckyLadyPayoutActivation.create({
        data: {
          gameId: LUCKY_LADY_PAYOUT_GAME_ID,
          actionId: input.actionId,
          action: input.action,
          candidateRowId: result.candidateId
            ? (await tx.luckyLadyPayoutCandidate.findUnique({
                where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: result.candidateId } },
                select: { id: true },
              }))?.id ?? null
            : null,
          candidateId: result.candidateId,
          modelProfileId: result.profileId,
          policyHash: result.policyHash,
          modelHash: result.modelHash,
          targetRtpPercent:
            result.targetRtpPercent === null ? null : new Prisma.Decimal(result.targetRtpPercent.toFixed(4)),
          maxWinMultiplier: result.maxWinMultiplier,
          style: result.style,
          version: result.version,
          previous: previousSnapshot as unknown as Prisma.InputJsonValue,
          actorId,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          targetType: 'CASINO_MATH_CONTROL',
          targetId: LUCKY_LADY_PAYOUT_GAME_ID,
          action: 'CASINO_MATH_PAYOUT_LIFECYCLE',
          result: 'OK',
          metadata: {
            action: input.action,
            actionId: input.actionId,
            semantics: input.semantics,
            candidateId: result.candidateId,
            profileId: result.profileId,
            policyHash: result.policyHash,
            modelHash: result.modelHash,
            version: result.version,
            previous: previousSnapshot,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return { kind: 'created' as const, row };
    });

    return this.resultFromRow(outcome.row, input.action, outcome.kind === 'replay');
  }

  private async resultFromRow(
    row: {
      action: string;
      version: number;
      modelProfileId: string | null;
      policyHash: string | null;
      modelHash: string | null;
      targetRtpPercent: Prisma.Decimal | null;
      maxWinMultiplier: number | null;
      style: string | null;
      candidateId: string | null;
      actorId: string;
      createdAt: Date;
    },
    action: LifecycleAction,
    replay: boolean,
  ): Promise<PayoutActivationResult> {
    let policyId: string | null = null;
    let validationId: string | null = null;
    if (row.candidateId) {
      const [candidate, validation] = await Promise.all([
        this.prisma.luckyLadyPayoutCandidate.findUnique({
          where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId: row.candidateId } },
        }),
        this.prisma.gameActiveMathProfile.findUnique({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } }),
      ]);
      policyId = candidate ? (candidate.distributionPolicy as unknown as StoredShape).policyId ?? null : null;
      validationId = validation?.payoutCandidateId === row.candidateId ? validation.validationId : null;
    }
    // A rollback can land on the default: it records no candidate, so the state
    // it produced is DEFAULT even though the row's action is ROLLBACK.
    const mode: 'DEFAULT' | 'CUSTOM' = row.action === 'DEFAULT' || row.candidateId === null ? 'DEFAULT' : 'CUSTOM';
    const active: PayoutActiveState = {
      mode,
      legacy: false,
      version: row.version,
      profileId: row.modelProfileId,
      profileHash: row.modelHash,
      validationId,
      policyId,
      policyHash: row.policyHash,
      modelId: row.modelProfileId,
      modelHash: row.modelHash,
      targetRtpPercent: row.targetRtpPercent === null ? null : Number(row.targetRtpPercent),
      maxWinMultiplier: row.maxWinMultiplier,
      style: row.style,
      activatedAt: row.createdAt.toISOString(),
      activatedBy: row.actorId,
      note:
        'The active policy applies to NEW paid rounds only; a round in flight keeps the mathematics it was opened under.',
    };
    return { gameId: LUCKY_LADY_PAYOUT_GAME_ID, action, replay, version: row.version, active };
  }

  private async movePointer(
    tx: Prisma.TransactionClient,
    input: {
      actorId: string;
      kind: 'GENERATED' | 'DEFAULT';
      profileRowId: string | null;
      profileId: string;
      profileHash: string;
      validationId: string | null;
      payoutCandidateId: string | null;
      expectedVersion?: number;
    },
  ) {
    const current = await tx.gameActiveMathProfile.findUnique({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } });
    const version = (current?.version ?? 0) + 1;
    if (!current) {
      return tx.gameActiveMathProfile.create({
        data: {
          gameId: LUCKY_LADY_PAYOUT_GAME_ID,
          profileRowId: input.profileRowId,
          profileId: input.profileId,
          profileHash: input.profileHash,
          validationId: input.validationId,
          kind: input.kind,
          payoutCandidateId: input.payoutCandidateId,
          version,
          activatedBy: input.actorId,
        },
      });
    }
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw new ConflictException({
        code: 'PAYOUT_ACTIVE_CONFLICT',
        message: `Active mathematics moved to version ${current.version}.`,
      });
    }
    const updated = await tx.gameActiveMathProfile.updateMany({
      where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, version: current.version },
      data: {
        profileRowId: input.profileRowId,
        profileId: input.profileId,
        profileHash: input.profileHash,
        validationId: input.validationId,
        kind: input.kind,
        payoutCandidateId: input.payoutCandidateId,
        version,
        activatedBy: input.actorId,
        activatedAt: new Date(),
      },
    });
    if (updated.count !== 1) {
      throw new ConflictException({
        code: 'PAYOUT_ACTIVE_CONFLICT',
        message: 'Another transition won the race; reload and retry.',
      });
    }
    return tx.gameActiveMathProfile.findUniqueOrThrow({ where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID } });
  }

  // -------------------------------------------------------------------------
  // Distribution config version (single authoritative pointer)
  // -------------------------------------------------------------------------

  private async writeDistributionVersion(
    tx: Prisma.TransactionClient,
    actorId: string,
    candidate: { targetRtpPercent: Prisma.Decimal; maxWinMultiplier: number; modelProfileId: string },
    distribution: DistributionPolicy,
  ) {
    const config = await tx.casinoGameConfig.upsert({
      where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
      create: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
      update: {},
      include: { activeVersion: true },
    });
    const highest = await tx.casinoGameConfigVersion.aggregate({
      where: { gameConfigId: config.id },
      _max: { version: true },
    });
    const next = (highest._max.version ?? 0) + 1;
    const baseGameSpecific = config.activeVersion
      ? ({ ...(config.activeVersion.gameSpecificConfig as Record<string, unknown>) } as Record<string, unknown>)
      : {};
    delete baseGameSpecific.distributionPolicy;
    delete baseGameSpecific.distributionPolicyHash;
    const gameSpecific = {
      ...baseGameSpecific,
      assignment: 'RTP_CONTROL_PANEL',
      payoutPolicyId: distribution.policyId,
      distributionPolicy: distribution as unknown as Prisma.InputJsonValue,
      distributionPolicyHash: distributionPolicyHash(distribution),
    };
    const version = await tx.casinoGameConfigVersion.create({
      data: {
        gameConfigId: config.id,
        version: next,
        label: `${distribution.policyId}.v${next}`,
        status: 'ACTIVE',
        minStake: config.activeVersion?.minStake ?? LUCKY_LADY_V1.minStake,
        maxStake: config.activeVersion?.maxStake ?? LUCKY_LADY_V1.maxStake,
        rtpBps: Math.round(Number(candidate.targetRtpPercent) * 100),
        gameSpecificConfig: gameSpecific as unknown as Prisma.InputJsonValue,
        createdByAdminId: actorId,
        reason: 'Admin RTP Control: activate generated payout policy',
        activatedAt: new Date(),
      },
    });
    if (config.activeVersionId) {
      await tx.casinoGameConfigVersion.updateMany({
        where: { id: config.activeVersionId },
        data: { status: 'SUPERSEDED', supersededAt: new Date() },
      });
    }
    await tx.casinoGameConfig.update({ where: { id: config.id }, data: { activeVersionId: version.id } });
  }

  /** Clear the runtime distribution so NEW rounds use the golden default maths. */
  private async clearDistributionVersion(tx: Prisma.TransactionClient, actorId: string) {
    const config = await tx.casinoGameConfig.findUnique({
      where: { gameId: LUCKY_LADY_PAYOUT_GAME_ID },
      include: { activeVersion: true },
    });
    if (!config?.activeVersion) return;
    const highest = await tx.casinoGameConfigVersion.aggregate({
      where: { gameConfigId: config.id },
      _max: { version: true },
    });
    const next = (highest._max.version ?? 0) + 1;
    const baseGameSpecific = { ...(config.activeVersion.gameSpecificConfig as Record<string, unknown>) };
    delete baseGameSpecific.distributionPolicy;
    delete baseGameSpecific.distributionPolicyHash;
    delete baseGameSpecific.payoutPolicyId;
    const gameSpecific = { ...baseGameSpecific, assignment: 'RTP_CONTROL_PANEL_DEFAULT' };
    const version = await tx.casinoGameConfigVersion.create({
      data: {
        gameConfigId: config.id,
        version: next,
        label: `lucky-lady.default.v${next}`,
        status: 'ACTIVE',
        minStake: config.activeVersion.minStake,
        maxStake: config.activeVersion.maxStake,
        // Default restores the declared golden return, never the custom target.
        rtpBps: LUCKY_LADY_V1.declaredRtpBps,
        gameSpecificConfig: gameSpecific as unknown as Prisma.InputJsonValue,
        createdByAdminId: actorId,
        reason: 'Admin RTP Control: restore golden default mathematics',
        activatedAt: new Date(),
      },
    });
    await tx.casinoGameConfigVersion.updateMany({
      where: { id: config.activeVersion.id },
      data: { status: 'SUPERSEDED', supersededAt: new Date() },
    });
    await tx.casinoGameConfig.update({ where: { id: config.id }, data: { activeVersionId: version.id } });
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async loadCandidate(candidateId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    const row = await client.luckyLadyPayoutCandidate.findUnique({
      where: { gameId_candidateId: { gameId: LUCKY_LADY_PAYOUT_GAME_ID, candidateId } },
    });
    if (!row) {
      throw new NotFoundException({ code: 'PAYOUT_CANDIDATE_NOT_FOUND', message: `No payout candidate ${candidateId}.` });
    }
    return row;
  }

  private async ensureModelProfile(
    tx: Prisma.TransactionClient,
    actorId: string,
    artifact: MathProfileArtifact,
  ): Promise<string> {
    const where = { gameId_canonicalHash: { gameId: artifact.gameId, canonicalHash: artifact.canonicalHash } };
    const existing = await tx.gameMathProfile.findUnique({ where });
    if (existing) return existing.id;
    try {
      const created = await tx.gameMathProfile.create({
        data: {
          gameId: artifact.gameId,
          profileId: artifact.profileId,
          canonicalHash: artifact.canonicalHash,
          engineSha256: artifact.engineSha256,
          rulesSha256: artifact.rulesSha256,
          targetRtpPercent: new Prisma.Decimal((artifact.policy.targetRtpPercent ?? 0).toFixed(6)),
          measuredRtpPercent: null,
          maxWinMultiplier: new Prisma.Decimal(artifact.policy.maxWinMultiplier.toFixed(6)),
          policy: artifact.policy as unknown as Prisma.InputJsonValue,
          analytic: { kind: 'LUCKY_LADY_BOUNDED_GENERATOR_MODEL' } as Prisma.InputJsonValue,
          payload: artifact.payload as Prisma.InputJsonValue,
          status: 'GENERATED',
          generatedBy: actorId,
        },
      });
      return created.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await tx.gameMathProfile.findUnique({ where });
      if (!raced) throw error;
      return raced.id;
    }
  }

  private async latestValidation(candidateRowId: string, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    return client.luckyLadyPayoutValidation.findFirst({
      where: { candidateRowId },
      orderBy: [{ createdAt: 'desc' }],
    });
  }

  /**
   * Rebuild the two frozen identities and refuse any tampered or drifted row.
   *
   * The model is regenerated from the accepted generator (so a mutated stored
   * JSON cannot change a payout), and the distribution is re-hashed. Both must
   * match the hashes recorded when the candidate was written.
   */
  private frozenIdentity(row: {
    distributionPolicy: Prisma.JsonValue;
    policyHash: string;
    modelHash: string;
    modelProfileId: string;
    maxWinMultiplier: number;
  }): { artifact: MathProfileArtifact; distribution: DistributionPolicy } {
    const model = luckyLadyGeneratorModel(row.maxWinMultiplier);
    if (model.artifact.canonicalHash !== row.modelHash || model.modelId !== row.modelProfileId) {
      throw new ConflictException({
        code: 'PAYOUT_MODEL_UNREPRODUCIBLE',
        message: 'The stored model no longer reproduces from the accepted generator.',
      });
    }
    const distribution = row.distributionPolicy as unknown as DistributionPolicy;
    if (distributionPolicyHash(distribution) !== row.policyHash) {
      throw new ConflictException({
        code: 'PAYOUT_DISTRIBUTION_HASH_MISMATCH',
        message: 'The stored distribution does not match its frozen hash.',
      });
    }
    if (distribution.mathProfileId !== model.modelId || distribution.mathProfileHash !== model.artifact.canonicalHash) {
      throw new ConflictException({
        code: 'PAYOUT_DISTRIBUTION_MODEL_MISMATCH',
        message: 'The stored distribution is not bound to the stored model.',
      });
    }
    if (distribution.maxWinMultiplier !== model.artifact.policy.maxWinMultiplier) {
      throw new ConflictException({
        code: 'PAYOUT_DISTRIBUTION_CAP_MISMATCH',
        message: 'The stored distribution cap does not match the stored model.',
      });
    }
    return { artifact: model.artifact, distribution };
  }

  private async goldenDefault(): Promise<PayoutCurrentView['defaultProfile']> {
    const verified = await import('../lucky-lady.math').then((module) => module.loadVerifiedMath());
    const profile = verified.profile as unknown as {
      id: string;
      maxWinMultiplier?: number;
      maxWinScope?: string;
      maxWinEnabled?: boolean;
    };
    return {
      profileId: profile.id,
      profileHash: verified.hashes.profileCanonicalHash,
      rtpPercent: verified.profile.targetRtpPercent,
      maxWinMultiplier: profile.maxWinMultiplier ?? null,
      maxWinScope: profile.maxWinScope ?? 'PAID_ROUND_BEFORE_OPTIONAL_GAMBLE',
      maxWinEnabled: profile.maxWinEnabled ?? null,
      note:
        'The accepted immutable golden profile: RTP50 at the default scope. The frozen file declares no ' +
        'max-win multiplier, so the game keeps its accepted uncapped semantics rather than a fabricated cap. ' +
        'Restoring default returns to this exact mathematics, never to a zero-return profile, and never ' +
        'deletes candidates or history.',
    };
  }

  private defaultActiveState(
    version: number,
    activatedAt: Date | null,
    activatedBy: string | null,
  ): PayoutActiveState {
    return {
      mode: 'DEFAULT',
      legacy: false,
      version,
      profileId: null,
      profileHash: null,
      validationId: null,
      policyId: null,
      policyHash: null,
      modelId: null,
      modelHash: null,
      targetRtpPercent: null,
      maxWinMultiplier: null,
      style: null,
      activatedAt: activatedAt?.toISOString() ?? null,
      activatedBy,
      note:
        'Golden default mathematics are live. No generated payout policy is active; restoring default ' +
        'preserves the monotonic pointer revision so a stale client cannot force an activate.',
    };
  }

  private normalizeRequest(raw: Record<string, unknown>): Record<string, unknown> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException({ code: 'PAYOUT_REQUEST_INVALID', message: 'A generation request object is required.' });
    }
    const allowed = new Set(['targetRtpPercent', 'targetRtp', 'maxWinMultiplier', 'pacing', 'objective', 'constraints']);
    const request: Record<string, unknown> = { gameId: LUCKY_LADY_PAYOUT_GAME_ID };
    for (const key of Object.keys(raw)) {
      if (!allowed.has(key)) continue;
      request[key] = raw[key];
    }
    if (raw.style !== undefined && raw.pacing === undefined && raw.objective === undefined) {
      if (!LUCKY_LADY_PAYOUT_STYLES.includes(raw.style as LuckyLadyPayoutStyle)) {
        throw new BadRequestException({
          code: 'PAYOUT_STYLE_UNSUPPORTED',
          message: `Style must be one of ${LUCKY_LADY_PAYOUT_STYLES.join(', ')}.`,
        });
      }
      // `style` is translated to the generator's objective field, never forwarded.
      request.objective = raw.style;
    }
    if (raw.constraints !== undefined) {
      request.constraints = this.normalizeConstraints(raw.constraints);
    }
    const target = raw.targetRtpPercent ?? raw.targetRtp;
    if (target === undefined) {
      throw new BadRequestException({ code: 'PAYOUT_TARGET_REQUIRED', message: 'A target return is required.' });
    }
    const maxWin = raw.maxWinMultiplier;
    if (typeof maxWin !== 'number' || !Number.isFinite(maxWin)) {
      throw new BadRequestException({ code: 'PAYOUT_MAX_WIN_REQUIRED', message: 'A max-win multiplier is required.' });
    }
    if (!LUCKY_LADY_PAYOUT_SUPPORTED_MAX_WIN.includes(maxWin as 20 | 50)) {
      throw new BadRequestException({
        code: 'PAYOUT_MAX_WIN_UNSUPPORTED',
        message:
          `The declared bounded generator supports max win ${LUCKY_LADY_PAYOUT_SUPPORTED_MAX_WIN.join('x or ')}x only; ` +
          `${maxWin}x is not supported and is refused rather than approximated.`,
      });
    }
    return request;
  }

  /** Forward only the accepted global constraint keys the generator implements. */
  private normalizeConstraints(input: unknown): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new BadRequestException({ code: 'PAYOUT_CONSTRAINTS_INVALID', message: 'Constraints must be an object.' });
    }
    const allowed = new Set([
      'maxFullLossRate',
      'requirePositiveLoss',
      'requirePositivePartial',
      'requirePositiveProfit',
      'minFeatureWeightFraction',
      'maxFeatureWeightFraction',
      'minimumWeightFraction',
      'maximumWeightFraction',
    ]);
    const constraints: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>)) {
      if (!allowed.has(key)) {
        throw new BadRequestException({
          code: 'PAYOUT_CONSTRAINT_UNSUPPORTED',
          message: `"${key}" is not a supported generation constraint.`,
        });
      }
      constraints[key] = (input as Record<string, unknown>)[key];
    }
    return constraints;
  }

  private styleOf(objective: string | undefined): string {
    if (objective && LUCKY_LADY_PAYOUT_STYLES.includes(objective as LuckyLadyPayoutStyle)) return objective;
    return 'BALANCED';
  }

  private modelArtifactFromCandidate(candidate: {
    model: { maxWinMultiplier: number; modelId: string } | null;
  }): MathProfileArtifact {
    const model = luckyLadyGeneratorModel(candidate.model?.maxWinMultiplier ?? 50);
    return model.artifact;
  }

  private metricsFromReport(
    report: import('../lucky-lady.policy-generator').GeneratedPolicyReport,
    context: {
      targetRtpPercent: number;
      declaredReturnPercent: number;
      policyHash: string;
      artifact: MathProfileArtifact;
    },
  ): PayoutReportMetrics {
    const bankroll: PolicyBankrollReport | null = report.bankroll;
    if (!bankroll) {
      throw new InternalServerErrorException({
        code: 'PAYOUT_REPORT_MISSING',
        message: 'The evidence run did not produce a bankroll report.',
      });
    }
    const alive = (checkpoint: number) => bankroll.survival[String(checkpoint)]?.rate ?? null;
    const percentile = (summary: { p90?: number | null } | undefined) => summary?.p90 ?? null;
    return {
      requestedRtpPercent: context.targetRtpPercent,
      declaredReturnPercent: context.declaredReturnPercent,
      expectedRtpPercent: bankroll.expected.rtpPercent,
      expectedRtpPercentExact: bankroll.expected.rtpPercentExact,
      measuredRtpPercent: bankroll.measured.rtpPercent,
      measuredRtpPercentExact: bankroll.measured.rtpPercentExact,
      rtpStandardErrorPercent: bankroll.measured.rtpStandardErrorPercent,
      rtp95IntervalPercent: bankroll.measured.rtp95IntervalPercent,
      absoluteDifferencePercent: report.statistical?.absoluteDifferencePercent ?? null,
      verdict: report.statistical?.verdict ?? 'NOT_RUN',
      tolerance: report.statistical?.tolerance ?? 'n/a',
      houseEdgePercent: bankroll.measured.houseEdgePercent,
      houseEdgePercentExact: bankroll.measured.houseEdgePercentExact,
      hitRate: bankroll.paidEvents.hit.rate,
      partialRate: bankroll.paidEvents.partial.rate,
      breakEvenRate: bankroll.paidEvents.breakEven.rate,
      lossRate: bankroll.paidEvents.fullLoss.rate,
      profitableRate: bankroll.paidEvents.profitable.rate,
      featureTriggerRate: bankroll.paidEvents.featureTriggered.rate,
      retriggerRate: bankroll.paidEvents.retriggered.rate,
      paidSessionLength: {
        median: bankroll.spins.perSessionPaidSpins.median,
        p90: bankroll.spins.perSessionPaidSpins.p90,
      },
      turnoverPts: {
        median: bankroll.turnover.perSessionPts.median,
        mean: bankroll.turnover.perSessionPts.mean,
      },
      alive500: alive(500),
      alive1000: alive(1_000),
      alive5000: alive(5_000),
      houseResultPts: {
        mean: bankroll.house.meanNetPtsPerSession,
        // `netPerSessionExact` is in simulation units; present its median in PTS.
        median: bankroll.house.netPerSessionExact.median === null
          ? null
          : bankroll.house.netPerSessionExact.median / 100,
      },
      houseResultUnitsMedian: bankroll.house.netPerSessionExact.median,
      fullLossStreak: {
        p90: bankroll.drySpells.fullLoss.longestPerSession.p90,
        p95: bankroll.drySpells.fullLoss.longestPerSession.p95,
      },
      nonProfitableStreakP90: bankroll.drySpells.nonProfitable.longestPerSession.p90,
      drySpellDefinitions: {
        fullLoss: bankroll.drySpells.fullLoss.definition,
        nonProfitable: bankroll.drySpells.nonProfitable.definition,
      },
      drawdownP90: percentile(bankroll.drawdown),
      maxPaidSpinUnitsExact: bankroll.maxObserved.paidSpinUnitsExact,
      maxFreeSpinUnitsExact: bankroll.maxObserved.freeSpinUnitsExact,
      maxFeatureChainUnitsExact: bankroll.maxObserved.featureAggregateUnitsExact,
      capUnitsExact: bankroll.maxObserved.capUnitsExact,
      paidSpinWithinCap: bankroll.maxObserved.paidSpinWithinCap,
      freeSpinWithinCap: bankroll.maxObserved.freeSpinWithinCap,
      featureAggregateExceedsCap: bankroll.maxObserved.featureAggregateExceedsCap,
      maxWinWasCapped: bankroll.maxObserved.paidSpinWithinCap && bankroll.maxObserved.freeSpinWithinCap,
      sampleSessions: bankroll.sample.sessions,
      sampleHorizonPaidSpins: bankroll.sample.horizonPaidSpins,
      censoredCount: bankroll.sample.censoredCount,
      censoringCaveat:
        `${bankroll.sample.censoredCount} of ${bankroll.sample.sessions} sessions were censored at the ` +
        `${bankroll.sample.horizonPaidSpins}-spin horizon; crash/length statistics are conditional on it.`,
    };
  }

  private candidateView(
    row: {
      candidateId: string;
      policyHash: string;
      modelHash: string;
      modelProfileId: string;
      requestHash: string | null;
      targetRtpPercent: Prisma.Decimal;
      declaredReturnPercent: Prisma.Decimal;
      maxWinMultiplier: number;
      style: string;
      createdAt: Date;
    },
    distribution: StoredDistribution,
    reasons: PayoutCandidateView['reasons'],
    stages: PayoutCandidateView['stages'],
  ): PayoutCandidateView {
    return {
      candidateId: row.candidateId,
      status: 'GENERATED',
      activated: false,
      targetRtpPercent: Number(row.targetRtpPercent),
      declaredReturnPercent: Number(row.declaredReturnPercent),
      maxWinMultiplier: row.maxWinMultiplier,
      style: row.style,
      policyId: distribution.policyId,
      policyHash: row.policyHash,
      modelId: row.modelProfileId,
      modelHash: row.modelHash,
      requestHash: row.requestHash,
      weights: distribution.weights,
      reasons,
      stages,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private storedDistribution(policy: DistributionPolicy): StoredDistribution {
    return { policyId: policy.policyId, policyHash: distributionPolicyHash(policy), weights: this.reconciledWeights(policy) };
  }

  private storedDistributionFromRow(row: {
    distributionPolicy: Prisma.JsonValue;
    policyHash: string;
  }): StoredDistribution {
    const raw = row.distributionPolicy as unknown as DistributionPolicy;
    return this.storedDistribution(raw);
  }

  private reconciledWeights(policy: DistributionPolicy): PayoutClassWeight[] {
    const total = DISTRIBUTION_CLASSES.reduce((sum, classId) => sum + (policy.weights[classId] ?? 0), 0);
    if (total <= 0) return [];
    const weights: PayoutClassWeight[] = [];
    let running = 0;
    DISTRIBUTION_CLASSES.forEach((classId, index) => {
      const units = policy.weights[classId] ?? 0;
      const percent = index === DISTRIBUTION_CLASSES.length - 1
        ? Number((100 - running).toFixed(4))
        : Number(((units / total) * 100).toFixed(4));
      running = Number((running + percent).toFixed(4));
      weights.push({ classId, units, percent });
    });
    return weights;
  }

  private evidencePath(candidateId: string, policyHash: string) {
    return `docs/agent-work/game-math-control/payout-evidence/${candidateId}-${policyHash.slice(0, 12)}.json`;
  }

  private unsolvedOutcome(
    status: string,
    reasons: PayoutCandidateView['reasons'],
    stages: PayoutCandidateView['stages'],
    view?: PayoutCandidateView,
    metrics?: PayoutReportMetrics,
  ) {
    const normalized = normalizeUnsolvedStatus(status);
    return {
      status: normalized,
      candidate: view ?? null,
      metrics: metrics ?? null,
      reasons,
      stages,
      message: describeUnsolved(normalized),
    };
  }

  private assertActivationCap(maxWinMultiplier: number) {
    assertGambleScopeResolved('RESOLVED_SPIN', maxWinMultiplier);
  }

  private requireActionId(actionId: string): string {
    const trimmed = (actionId ?? '').trim();
    if (trimmed.length < 8 || trimmed.length > 120) {
      throw new BadRequestException({
        code: 'PAYOUT_ACTION_ID_INVALID',
        message: 'An action id between 8 and 120 characters is required for replay safety.',
      });
    }
    return trimmed;
  }

  private audit(actorId: string, action: string, metadata: Record<string, unknown>) {
    return this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_MATH_CONTROL',
        targetId: LUCKY_LADY_PAYOUT_GAME_ID,
        action: 'CASINO_MATH_PAYOUT_LIFECYCLE',
        result: 'OK',
        metadata: { action, ...metadata } as Prisma.InputJsonValue,
      },
    });
  }
}

type PayoutSnapshotBase = {
  version: number;
  validationId: string | null;
  candidateId: string | null;
  profileId: string;
  profileHash: string;
  engineSha256: string;
  rulesSha256: string;
  modelPayload: unknown;
  targetRtpPercent: number;
};

export type ActivePayoutSnapshot = PayoutSnapshotBase & (
  | { mode: 'DEFAULT'; policy: null; policyId: null; policyHash: null; distributionPolicy: null }
  | { mode: 'CUSTOM'; policy: MathPolicy; policyId: string | null; policyHash: string | null; distributionPolicy: DistributionPolicy | null }
);

type TransitionOutcome = {
  mode: 'DEFAULT' | 'CUSTOM';
  candidateId: string | null;
  profileId: string | null;
  policyId: string | null;
  policyHash: string | null;
  modelHash: string | null;
  targetRtpPercent: number | null;
  maxWinMultiplier: number | null;
  style: string | null;
  version: number;
};

type StoredShape = { policyId?: string | null };

export function normalizeUnsolvedStatus(
  status: string,
): 'SEARCH_EXHAUSTED' | 'INFEASIBLE' | 'REJECTED' | 'GENERATED' {
  return ['SEARCH_EXHAUSTED', 'INFEASIBLE', 'REJECTED', 'GENERATED'].includes(status)
    ? (status as 'SEARCH_EXHAUSTED' | 'INFEASIBLE' | 'REJECTED' | 'GENERATED')
    : 'REJECTED';
}

/**
 * The honest operator-facing message for an unsolved generation request.
 *
 * A search-exhausted result is a bounded-solver limit and is never phrased as
 * mathematical impossibility; only an explicit INFEASIBLE result says that.
 */
export function describeUnsolved(status: string): string {
  const normalized = normalizeUnsolvedStatus(status);
  if (normalized === 'SEARCH_EXHAUSTED') {
    return 'The bounded solver exhausted its declared search ladder without finding a candidate. This is a ' +
      'search-space limit, not a statement that the request is mathematically infeasible.';
  }
  if (normalized === 'INFEASIBLE') {
    return 'The declared model proves this request infeasible under its support and ceilings.';
  }
  return 'The request was rejected before a candidate was accepted.';
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}
