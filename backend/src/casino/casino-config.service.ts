import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CasinoConfigStatus, Prisma, Role } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { hasCapability } from '../auth/capabilities';
import { CASINO_GAME_IDS, CasinoGameId, CasinoGameRegistry } from './casino-game.registry';
import {
  GAME_CONFIG_SPECS,
  MAX_RTP_BPS,
  MIN_RTP_BPS,
  candidateRtpBps,
} from './casino-config.defaults';
import { EffectiveGameConfig, GameConfigCandidate } from './casino-config.types';

/** A transaction client (or the pool) that config reads may be issued through. */
export type ConfigReader = Pick<Prisma.TransactionClient, 'platformSettings' | 'casinoGameConfig'>;

type MutableFlags = { enabled?: boolean; maintenance?: boolean };

const isGameId = (value: string): value is CasinoGameId =>
  (CASINO_GAME_IDS as readonly string[]).includes(value);

/**
 * Persistent, versioned casino configuration.
 *
 * An operator controls *future* configuration and nothing else. There is no
 * method here that can influence a particular round: activating a version
 * changes which mathematics the next round is opened under, and a round already
 * in flight keeps the version it recorded.
 *
 * Every version is immutable once written. Changing a number means creating a
 * new version and superseding the old one, which is what keeps a settled round
 * verifiable forever.
 */
@Injectable()
export class CasinoConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CasinoGameRegistry,
  ) {}

  /**
   * Re-reads the actor's role from the database on every mutation.
   *
   * An access token proves who signed in, not what they are allowed to do now:
   * a demoted administrator holding a still-valid token must not be able to
   * reprice a game.
   */
  private async assertAdmin(actorId: string, operation: string, targetId?: string) {
    const actor = await this.prisma.user.findUnique({
      where: { id: actorId },
      select: { role: true, disabled: true },
    });
    if (actor && !actor.disabled && hasCapability(actor.role, 'GAME_ADMIN')) return;
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'CASINO_CONFIG',
        targetId: targetId ?? operation,
        action: 'PERMISSION_DENIED',
        result: 'DENIED',
        metadata: { operation },
      },
    });
    throw new ForbiddenException('ADMIN_REQUIRED');
  }

  private spec(gameId: string) {
    if (!isGameId(gameId)) {
      throw new NotFoundException({
        code: 'CASINO_GAME_NOT_FOUND',
        message: 'That casino game does not exist.',
      });
    }
    return GAME_CONFIG_SPECS[gameId];
  }

  /**
   * Guarantees a config row and its seeded first version exist.
   *
   * The seed reuses the label the engines already emit, so rounds settled
   * before this system existed still resolve to a matching version.
   */
  private async ensure(gameId: CasinoGameId) {
    const existing = await this.prisma.casinoGameConfig.findUnique({
      where: { gameId },
      include: { activeVersion: true },
    });
    if (existing?.activeVersion) return existing;

    const baseline = this.spec(gameId).baseline();
    try {
      return await this.prisma.$transaction(async (tx) => {
        const config = await tx.casinoGameConfig.upsert({
          where: { gameId },
          create: { gameId },
          update: {},
        });
        const already = await tx.casinoGameConfigVersion.findFirst({
          where: { gameConfigId: config.id, status: 'ACTIVE' },
        });
        if (already) {
          return tx.casinoGameConfig.findUniqueOrThrow({
            where: { id: config.id },
            include: { activeVersion: true },
          });
        }
        const version = await tx.casinoGameConfigVersion.create({
          data: {
            gameConfigId: config.id,
            version: 1,
            label: baseline.label,
            status: 'ACTIVE',
            minStake: baseline.minStake,
            maxStake: baseline.maxStake,
            rtpBps: baseline.rtpBps,
            gameSpecificConfig: baseline.gameSpecific as Prisma.InputJsonValue,
            reason: 'Seeded from the built-in game mathematics.',
            activatedAt: new Date(),
          },
        });
        await tx.casinoGameConfig.update({
          where: { id: config.id },
          data: { activeVersionId: version.id },
        });
        return tx.casinoGameConfig.findUniqueOrThrow({
          where: { id: config.id },
          include: { activeVersion: true },
        });
      });
    } catch (error) {
      // A concurrent first request may have seeded it already.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return this.prisma.casinoGameConfig.findUniqueOrThrow({
          where: { gameId },
          include: { activeVersion: true },
        });
      }
      throw error;
    }
  }

  /**
   * Read-only view of a game's config row through a caller-supplied client.
   *
   * Used when the caller already holds a transaction connection: it must not
   * ask the pool for another one, and it must not write. A row that has not been
   * seeded yet reads as the baseline defaults, which is exactly what seeding
   * would produce (version 1 is seeded from the baseline), so the effective limits
   * are identical. `ensure()` still seeds on the pool path.
   */
  private async readConfig(gameId: CasinoGameId, db: ConfigReader) {
    const existing = await db.casinoGameConfig.findUnique({ where: { gameId }, include: { activeVersion: true } });
    if (existing) return existing;
    return { enabled: true, maintenance: false, activeVersion: null } as unknown as Awaited<ReturnType<CasinoConfigService['ensure']>>;
  }

  /**
   * The configuration a *new* round of this game must be opened under.
   *
   * Pass `db` (an open transaction client) when already inside a transaction so
   * no second pooled connection is acquired while that one is held.
   */
  async effective(gameId: CasinoGameId, db?: ConfigReader): Promise<EffectiveGameConfig> {
    const config = db ? await this.readConfig(gameId, db) : await this.ensure(gameId);
    const active = config.activeVersion;
    const baseline = this.spec(gameId).baseline();
    if (!active) {
      return {
        gameId,
        enabled: config.enabled,
        maintenance: config.maintenance,
        minStake: baseline.minStake,
        maxStake: baseline.maxStake,
        rtpBps: baseline.rtpBps,
        gameSpecific: baseline.gameSpecific,
        versionLabel: baseline.label,
        versionId: null,
        versionNumber: 1,
      };
    }
    return {
      gameId,
      enabled: config.enabled,
      maintenance: config.maintenance,
      minStake: active.minStake,
      maxStake: active.maxStake,
      rtpBps: active.rtpBps,
      gameSpecific: (active.gameSpecificConfig ?? {}) as Record<string, unknown>,
      versionLabel: active.label,
      versionId: active.id,
      versionNumber: active.version,
    };
  }

  /**
   * The frozen configuration a round already recorded.
   *
   * Actions on an in-flight round resolve through here, never through the
   * active version, so activating new mathematics can never reprice a hand,
   * a mines ladder, or a crash curve that is already running.
   */
  async frozen(gameId: CasinoGameId, label: string): Promise<EffectiveGameConfig> {
    const version = await this.prisma.casinoGameConfigVersion.findFirst({
      where: { label, config: { gameId } },
      include: { config: true },
    });
    if (version) {
      return {
        gameId,
        enabled: version.config.enabled,
        maintenance: version.config.maintenance,
        minStake: version.minStake,
        maxStake: version.maxStake,
        rtpBps: version.rtpBps,
        gameSpecific: (version.gameSpecificConfig ?? {}) as Record<string, unknown>,
        versionLabel: version.label,
        versionId: version.id,
        versionNumber: version.version,
      };
    }
    // A round from before this system, or from a version since removed: fall
    // back to the baseline shape and recover the return from the label itself.
    const baseline = this.spec(gameId).baseline();
    const encoded = /\.rtp(\d+)/.exec(label);
    return {
      gameId,
      enabled: true,
      maintenance: false,
      minStake: baseline.minStake,
      maxStake: baseline.maxStake,
      rtpBps: encoded ? Number(encoded[1]) : baseline.rtpBps,
      gameSpecific: baseline.gameSpecific,
      versionLabel: label,
      versionId: null,
      versionNumber: 0,
    };
  }

  /**
   * The single platform settings row, created on first use.
   *
   * `upsert` is a read-then-insert, so two concurrent first callers could both
   * insert and one failed with a unique violation. Creation is instead a single
   * `INSERT ... ON CONFLICT DO NOTHING` on the primary key: every concurrent first
   * caller succeeds and exactly one row can exist. Nothing is caught or hidden.
   */
  private async platform() {
    const existing = await this.prisma.platformSettings.findUnique({ where: { id: 'singleton' } });
    if (existing) return existing;
    await this.prisma.platformSettings.createMany({ data: [{ id: 'singleton' }], skipDuplicates: true });
    return this.prisma.platformSettings.findUniqueOrThrow({ where: { id: 'singleton' } });
  }

  /** Read-only platform flags through a caller-supplied client (no pool acquisition, no write). */
  private async platformIn(db: ConfigReader) {
    const row = await db.platformSettings.findUnique({ where: { id: 'singleton' } });
    return { casinoMaintenance: row?.casinoMaintenance ?? false };
  }

  async platformSettings() {
    return this.platform();
  }

  /**
   * Gate for opening a *new* round. Deliberately not applied to actions on an
   * existing round: an operator enabling maintenance must never trap a stake
   * that has already been debited.
   */
  async assertPlayable(gameId: CasinoGameId, db?: ConfigReader) {
    const platform = db ? await this.platformIn(db) : await this.platform();
    if (platform.casinoMaintenance) {
      throw new ServiceUnavailableException({
        code: 'CASINO_MAINTENANCE',
        message: 'The casino is temporarily unavailable.',
      });
    }
    const config = await this.effective(gameId, db);
    // The registry keeps its own build-time switch; both must allow play.
    this.registry.assertEnabled(gameId);
    if (!config.enabled) {
      throw new ServiceUnavailableException({
        code: 'CASINO_GAME_DISABLED',
        message: 'This casino game is currently unavailable.',
      });
    }
    if (config.maintenance) {
      throw new ServiceUnavailableException({
        code: 'CASINO_GAME_MAINTENANCE',
        message: 'This game is under maintenance.',
      });
    }
    return config;
  }

  /**
   * Player-facing availability for the whole casino.
   *
   * Read-only and role-free: this is exactly what the lobby renders, so a game
   * an operator has disabled or put into maintenance is shown as unavailable
   * instead of only failing at the moment someone tries to stake. Rows that
   * have not been seeded yet fall back to the schema defaults rather than
   * writing on a plain read.
   */
  async availability() {
    const [platform, configs] = await Promise.all([
      this.platform(),
      this.prisma.casinoGameConfig.findMany({
        select: { gameId: true, enabled: true, maintenance: true },
      }),
    ]);
    const byGame = new Map(configs.map((config) => [config.gameId, config]));
    return {
      casinoMaintenance: platform.casinoMaintenance,
      sportsbookMaintenance: platform.sportsbookMaintenance,
      games: Object.fromEntries(CASINO_GAME_IDS.map((gameId) => [
        gameId,
        {
          enabled: byGame.get(gameId)?.enabled ?? true,
          maintenance: byGame.get(gameId)?.maintenance ?? false,
        },
      ])) as Record<CasinoGameId, { enabled: boolean; maintenance: boolean }>,
    };
  }

  async assertSportsbookOpen() {
    const platform = await this.platform();
    if (platform.sportsbookMaintenance) {
      throw new ServiceUnavailableException({
        code: 'SPORTSBOOK_MAINTENANCE',
        message: 'The sportsbook is temporarily unavailable.',
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Administrative surface
  // ---------------------------------------------------------------------------

  private validateCandidate(gameId: CasinoGameId, candidate: GameConfigCandidate) {
    if (candidate.minStake <= 0n) {
      throw new BadRequestException({ code: 'INVALID_STAKE_LIMITS', message: 'Minimum stake must be positive.' });
    }
    if (candidate.maxStake < candidate.minStake) {
      throw new BadRequestException({ code: 'INVALID_STAKE_LIMITS', message: 'Maximum stake must not be below the minimum.' });
    }
    if (candidate.maxStake > 1_000_000_000n) {
      throw new BadRequestException({ code: 'INVALID_STAKE_LIMITS', message: 'Maximum stake is above the platform ceiling.' });
    }
    try {
      GAME_CONFIG_SPECS[gameId].validate(candidate);
    } catch (error) {
      const code = (error as { code?: string }).code ?? 'INVALID_CONFIG';
      throw new BadRequestException({ code, message: (error as Error).message });
    }
  }

  /** Validates a candidate without persisting it, for the admin preview panel. */
  async preview(actorId: string, gameId: string, candidate: GameConfigCandidate) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_PREVIEW', gameId);
    const spec = this.spec(gameId);
    this.validateCandidate(spec.gameId, candidate);
    const effectiveRtp = candidateRtpBps(spec.gameId, candidate);
    const current = await this.effective(spec.gameId);
    return {
      gameId: spec.gameId,
      valid: true,
      rtpControl: spec.rtpControl,
      proposedLabel: spec.label(candidate, current.versionNumber + 1),
      rtpBps: effectiveRtp,
      houseEdgeBps: effectiveRtp === null ? null : 10_000 - effectiveRtp,
      minStake: candidate.minStake.toString(),
      maxStake: candidate.maxStake.toString(),
      gameSpecific: candidate.gameSpecific,
      appliesTo: 'NEW_ROUNDS_ONLY',
    };
  }

  /** Creates a DRAFT version. Nothing becomes live until it is activated. */
  async createVersion(
    actorId: string,
    gameId: string,
    candidate: GameConfigCandidate,
    reason?: string,
  ) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_CREATE', gameId);
    const spec = this.spec(gameId);
    this.validateCandidate(spec.gameId, candidate);
    const config = await this.ensure(spec.gameId);
    const effectiveRtp = candidateRtpBps(spec.gameId, candidate);

    const created = await this.prisma.$transaction(async (tx) => {
      // Serialise version numbering on the same lock activation uses, so two
      // administrators drafting at once get consecutive versions rather than
      // colliding on the unique (config, version) pair.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:config:${spec.gameId}`}))`;
      const highest = await tx.casinoGameConfigVersion.aggregate({
        where: { gameConfigId: config.id },
        _max: { version: true },
      });
      const next = (highest._max.version ?? 0) + 1;
      const version = await tx.casinoGameConfigVersion.create({
        data: {
          gameConfigId: config.id,
          version: next,
          label: spec.label(candidate, next),
          status: 'DRAFT',
          minStake: candidate.minStake,
          maxStake: candidate.maxStake,
          rtpBps: effectiveRtp,
          gameSpecificConfig: candidate.gameSpecific as Prisma.InputJsonValue,
          createdByAdminId: actorId,
          reason: reason?.trim() || null,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          targetType: 'CASINO_CONFIG',
          targetId: spec.gameId,
          action: 'CASINO_CONFIG_CREATED',
          result: 'DRAFT',
          metadata: {
            gameId: spec.gameId,
            version: next,
            label: version.label,
            rtpBps: effectiveRtp,
            minStake: candidate.minStake.toString(),
            maxStake: candidate.maxStake.toString(),
            reason: reason?.trim() ?? null,
          },
        },
      });
      return version;
    });
    return this.projectVersion(created);
  }

  /**
   * Activates a draft atomically.
   *
   * A transaction-scoped advisory lock on the game serialises competing
   * activations, and `expectedCurrentVersion` makes a stale editor fail loudly
   * instead of silently overwriting a colleague's change.
   */
  async activateVersion(
    actorId: string,
    gameId: string,
    versionId: string,
    expectedCurrentVersion?: number,
  ) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_ACTIVATE', gameId);
    const spec = this.spec(gameId);
    await this.ensure(spec.gameId);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`casino:config:${spec.gameId}`}))`;
      const config = await tx.casinoGameConfig.findUniqueOrThrow({
        where: { gameId: spec.gameId },
        include: { activeVersion: true },
      });
      const current = config.activeVersion;

      if (
        expectedCurrentVersion !== undefined
        && current
        && current.version !== expectedCurrentVersion
      ) {
        throw new ConflictException({
          code: 'CONFIG_VERSION_CONFLICT',
          message: `This game is now on version ${current.version}; reload before activating.`,
        });
      }

      const candidate = await tx.casinoGameConfigVersion.findFirst({
        where: { id: versionId, gameConfigId: config.id },
      });
      if (!candidate) {
        throw new NotFoundException({ code: 'CONFIG_VERSION_NOT_FOUND', message: 'That configuration version does not exist.' });
      }
      if (candidate.status === 'ACTIVE') {
        throw new ConflictException({ code: 'CONFIG_ALREADY_ACTIVE', message: 'That version is already active.' });
      }
      if (candidate.status === 'SUPERSEDED') {
        throw new ConflictException({ code: 'CONFIG_VERSION_SUPERSEDED', message: 'A superseded version cannot be reactivated.' });
      }

      // Re-validate at activation: an invalid configuration must never go live,
      // even if the code's validation rules tightened after it was drafted.
      this.validateCandidate(spec.gameId, {
        minStake: candidate.minStake,
        maxStake: candidate.maxStake,
        rtpBps: candidate.rtpBps,
        gameSpecific: (candidate.gameSpecificConfig ?? {}) as Record<string, unknown>,
      });

      if (current) {
        await tx.casinoGameConfigVersion.update({
          where: { id: current.id },
          data: { status: 'SUPERSEDED', supersededAt: new Date() },
        });
      }
      const activated = await tx.casinoGameConfigVersion.update({
        where: { id: candidate.id },
        data: { status: 'ACTIVE', activatedAt: new Date() },
      });
      await tx.casinoGameConfig.update({
        where: { id: config.id },
        data: { activeVersionId: activated.id },
      });
      await tx.auditLog.create({
        data: {
          actorId,
          targetType: 'CASINO_CONFIG',
          targetId: spec.gameId,
          action: 'CASINO_CONFIG_ACTIVATED',
          result: 'ACTIVE',
          metadata: {
            gameId: spec.gameId,
            previousVersion: current?.version ?? null,
            previousLabel: current?.label ?? null,
            newVersion: activated.version,
            newLabel: activated.label,
            rtpBps: activated.rtpBps,
            minStake: activated.minStake.toString(),
            maxStake: activated.maxStake.toString(),
            appliesTo: 'NEW_ROUNDS_ONLY',
          },
        },
      });
      return activated;
    }, { maxWait: 10_000, timeout: 20_000 });

    return this.projectVersion(result);
  }

  /** Enable/disable and per-game maintenance. */
  async setStatus(actorId: string, gameId: string, flags: MutableFlags) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_STATUS', gameId);
    const spec = this.spec(gameId);
    const before = await this.ensure(spec.gameId);
    if (flags.enabled === undefined && flags.maintenance === undefined) {
      throw new BadRequestException({ code: 'NO_CHANGES', message: 'Provide enabled or maintenance.' });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const config = await tx.casinoGameConfig.update({
        where: { gameId: spec.gameId },
        data: {
          ...(flags.enabled === undefined ? {} : { enabled: flags.enabled }),
          ...(flags.maintenance === undefined ? {} : { maintenance: flags.maintenance }),
        },
      });
      if (flags.enabled !== undefined && flags.enabled !== before.enabled) {
        await tx.auditLog.create({
          data: {
            actorId,
            targetType: 'CASINO_CONFIG',
            targetId: spec.gameId,
            action: flags.enabled ? 'CASINO_GAME_ENABLED' : 'CASINO_GAME_DISABLED',
            result: flags.enabled ? 'ENABLED' : 'DISABLED',
            metadata: { gameId: spec.gameId, previous: before.enabled, next: flags.enabled },
          },
        });
      }
      if (flags.maintenance !== undefined && flags.maintenance !== before.maintenance) {
        await tx.auditLog.create({
          data: {
            actorId,
            targetType: 'CASINO_CONFIG',
            targetId: spec.gameId,
            action: 'CASINO_MAINTENANCE_CHANGED',
            result: flags.maintenance ? 'ON' : 'OFF',
            metadata: {
              gameId: spec.gameId,
              previous: before.maintenance,
              next: flags.maintenance,
            },
          },
        });
      }
      return config;
    });

    return {
      gameId: spec.gameId,
      enabled: updated.enabled,
      maintenance: updated.maintenance,
    };
  }

  /** Global casino and sportsbook maintenance switches. */
  async setPlatformMaintenance(
    actorId: string,
    flags: { casinoMaintenance?: boolean; sportsbookMaintenance?: boolean },
  ) {
    await this.assertAdmin(actorId, 'PLATFORM_MAINTENANCE');
    if (flags.casinoMaintenance === undefined && flags.sportsbookMaintenance === undefined) {
      throw new BadRequestException({ code: 'NO_CHANGES', message: 'Provide at least one switch.' });
    }
    const before = await this.platform();
    const updated = await this.prisma.platformSettings.update({
      where: { id: 'singleton' },
      data: {
        ...(flags.casinoMaintenance === undefined ? {} : { casinoMaintenance: flags.casinoMaintenance }),
        ...(flags.sportsbookMaintenance === undefined ? {} : { sportsbookMaintenance: flags.sportsbookMaintenance }),
        updatedByAdminId: actorId,
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorId,
        targetType: 'PLATFORM',
        targetId: 'maintenance',
        action: 'PLATFORM_MAINTENANCE_CHANGED',
        result: 'UPDATED',
        metadata: {
          previous: {
            casinoMaintenance: before.casinoMaintenance,
            sportsbookMaintenance: before.sportsbookMaintenance,
          },
          next: {
            casinoMaintenance: updated.casinoMaintenance,
            sportsbookMaintenance: updated.sportsbookMaintenance,
          },
        },
      },
    });
    return {
      casinoMaintenance: updated.casinoMaintenance,
      sportsbookMaintenance: updated.sportsbookMaintenance,
      updatedAt: updated.updatedAt,
    };
  }

  private projectVersion(version: {
    id: string;
    version: number;
    label: string;
    status: CasinoConfigStatus;
    minStake: bigint;
    maxStake: bigint;
    rtpBps: number | null;
    gameSpecificConfig: Prisma.JsonValue;
    createdByAdminId: string | null;
    reason: string | null;
    createdAt: Date;
    activatedAt: Date | null;
    supersededAt: Date | null;
  }) {
    return {
      versionId: version.id,
      version: version.version,
      label: version.label,
      status: version.status,
      minStake: version.minStake.toString(),
      maxStake: version.maxStake.toString(),
      rtpBps: version.rtpBps,
      houseEdgeBps: version.rtpBps === null ? null : 10_000 - version.rtpBps,
      rtpPercent: version.rtpBps === null ? null : (version.rtpBps / 100).toFixed(2),
      gameSpecific: version.gameSpecificConfig,
      createdByAdminId: version.createdByAdminId,
      reason: version.reason,
      createdAt: version.createdAt,
      activatedAt: version.activatedAt,
      supersededAt: version.supersededAt,
    };
  }

  /** Every game's operator-visible configuration state. */
  async listConfigs(actorId: string) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_LIST');
    const platform = await this.platform();
    const games = [];
    for (const gameId of CASINO_GAME_IDS) {
      const config = await this.ensure(gameId);
      const spec = GAME_CONFIG_SPECS[gameId];
      const entry = this.registry.findById(gameId);
      games.push({
        gameId,
        name: entry?.name ?? gameId,
        category: entry?.category ?? null,
        gameType: entry?.gameType ?? null,
        rtpControl: spec.rtpControl,
        rtpBounds: { minBps: MIN_RTP_BPS, maxBps: MAX_RTP_BPS },
        enabled: config.enabled,
        maintenance: config.maintenance,
        activeVersion: config.activeVersion ? this.projectVersion(config.activeVersion) : null,
      });
    }
    return { platform: {
      casinoMaintenance: platform.casinoMaintenance,
      sportsbookMaintenance: platform.sportsbookMaintenance,
      updatedAt: platform.updatedAt,
    }, games };
  }

  async gameConfig(actorId: string, gameId: string) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_DETAIL', gameId);
    const spec = this.spec(gameId);
    const config = await this.ensure(spec.gameId);
    const entry = this.registry.findById(spec.gameId);
    return {
      gameId: spec.gameId,
      name: entry?.name ?? spec.gameId,
      rtpControl: spec.rtpControl,
      rtpBounds: { minBps: MIN_RTP_BPS, maxBps: MAX_RTP_BPS },
      enabled: config.enabled,
      maintenance: config.maintenance,
      activeVersion: config.activeVersion ? this.projectVersion(config.activeVersion) : null,
      baseline: (() => {
        const baseline = spec.baseline();
        return {
          minStake: baseline.minStake.toString(),
          maxStake: baseline.maxStake.toString(),
          rtpBps: baseline.rtpBps,
          gameSpecific: baseline.gameSpecific,
          label: baseline.label,
        };
      })(),
    };
  }

  async versions(actorId: string, gameId: string, limit: number) {
    await this.assertAdmin(actorId, 'CASINO_CONFIG_VERSIONS', gameId);
    const spec = this.spec(gameId);
    const config = await this.ensure(spec.gameId);
    const versions = await this.prisma.casinoGameConfigVersion.findMany({
      where: { gameConfigId: config.id },
      orderBy: [{ version: 'desc' }],
      take: limit,
      include: { createdBy: { select: { id: true, email: true } } },
    });
    return {
      gameId: spec.gameId,
      versions: versions.map((version) => ({
        ...this.projectVersion(version),
        createdBy: version.createdBy,
      })),
    };
  }
}
