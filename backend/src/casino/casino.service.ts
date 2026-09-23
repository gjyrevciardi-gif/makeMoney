import { Injectable, NotFoundException } from '@nestjs/common';
import { CasinoGameType, CasinoRoundStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  CasinoGameFilters,
  CasinoGameRegistry,
} from './casino-game.registry';
import { CasinoConfigService } from './casino-config.service';
import { CasinoRoundService } from './casino-round.service';
import { CasinoFairnessService } from './casino-fairness.service';
import { DiceService } from './games/dice/dice.service';
import { MinesService } from './games/mines/mines.service';
import { RouletteService } from './games/roulette/roulette.service';
import { BlackjackService } from './games/blackjack/blackjack.service';
import { CrashService } from './games/crash/crash.service';
import { PlinkoService } from './games/plinko/plinko.service';
import { SlotsService } from './games/slots/slots.service';
import { TumbleSlotsService } from './games/slots/tumble.service';

/**
 * Cross-game casino reads: lobby metadata, per-user history, and the public
 * fairness verification of a finished round. Every query is scoped to the
 * authenticated user; no endpoint accepts a user id.
 */
@Injectable()
export class CasinoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: CasinoGameRegistry,
    private readonly configs: CasinoConfigService,
    private readonly rounds: CasinoRoundService,
    private readonly fairness: CasinoFairnessService,
    private readonly dice: DiceService,
    private readonly mines: MinesService,
    private readonly roulette: RouletteService,
    private readonly blackjack: BlackjackService,
    private readonly crash: CrashService,
    private readonly plinko: PlinkoService,
    private readonly slots: SlotsService,
    private readonly tumble: TumbleSlotsService,
  ) {}

  /**
   * Lobby metadata merged with the operator's live availability.
   *
   * The registry owns names, routes and categories; the configuration service
   * owns whether a game may be played right now. Merging them here is what lets
   * the lobby show a disabled or under-maintenance game honestly instead of
   * offering it and failing only once a player tries to stake.
   */
  async games(filters: CasinoGameFilters = {}) {
    const availability = await this.configs.availability();
    return {
      platform: { casinoMaintenance: availability.casinoMaintenance },
      games: this.registry.list(filters).map((game) => {
        const status = availability.games[game.id];
        return {
          ...game,
          // Both switches must allow play: the build-time registry switch and
          // the operator's persisted one.
          enabled: game.enabled && status.enabled,
          maintenance: status.maintenance || availability.casinoMaintenance,
        };
      }),
      limits: (() => {
        const config = this.registry.config('DICE');
        return config
          ? { minStake: config.minStake, maxStake: config.maxStake }
          : null;
      })(),
    };
  }

  /** Applies the same availability merge to a preference-driven list. */
  private async withAvailability<T extends { id: string; enabled: boolean }>(games: T[]) {
    const availability = await this.configs.availability();
    return games.map((game) => {
      const status = availability.games[game.id as keyof typeof availability.games];
      return {
        ...game,
        enabled: game.enabled && (status?.enabled ?? true),
        maintenance: (status?.maintenance ?? false) || availability.casinoMaintenance,
      };
    });
  }

  /**
   * Public rules for one game, reflecting the operator's active configuration.
   *
   * Every per-game projection is asynchronous now that limits and mathematics
   * come from the database, so each branch is awaited rather than spread - a
   * spread of a pending promise would silently publish an empty object.
   */
  async gameConfig(gameType: CasinoGameType) {
    // Blackjack publishes a rule set rather than an RTP, so it has its own
    // projection instead of the shared RTP-based one.
    if (gameType === 'BLACKJACK') return this.blackjack.publicConfig();
    // Plinko publishes its frozen paytables rather than a single RTP number.
    if (gameType === 'PLINKO') return this.plinko.publicConfig();
    // Slots publish the currently active approved profile. There are two slot
    // families behind the one settlement type, and each publishes its own
    // shape, so the type-level answer is simply both catalogues.
    if (gameType === 'SLOTS') {
      const [payline, tumble] = await Promise.all([
        this.slots.publicConfig(),
        this.tumble.publicConfig(),
      ]);
      return { gameType: 'SLOTS', games: [...payline.games, ...tumble.games] };
    }
    const config = this.registry.config(gameType);
    if (!config) {
      throw new NotFoundException({ code: 'GAME_NOT_AVAILABLE', message: 'That game is not available yet.' });
    }
    const extra = gameType === 'DICE'
      ? await this.dice.publicConfig()
      : gameType === 'MINES'
        ? await this.mines.publicConfig()
        : gameType === 'ROULETTE'
          ? await this.roulette.publicConfig()
          : gameType === 'CRASH'
            ? await this.crash.publicConfig()
            : {};
    return { ...config, ...extra };
  }

  async history(
    userId: string,
    filters: { limit: number; gameType?: CasinoGameType; status?: CasinoRoundStatus },
  ) {
    const rounds = await this.prisma.casinoRound.findMany({
      where: { userId, gameType: filters.gameType, status: filters.status },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: filters.limit,
    });
    return { rounds: rounds.map((round) => this.rounds.publicView(round)) };
  }

  async round(userId: string, roundId: string) {
    const round = await this.rounds.ownedRound(userId, roundId);
    return this.rounds.publicView(round);
  }

  /**
   * Verifiable result: recomputes the commitment for a finished round so the
   * player can confirm the seed was fixed before play. Open rounds are refused
   * because revealing their seed would expose the outcome.
   */
  async verify(userId: string, roundId: string) {
    const round = await this.rounds.ownedRound(userId, roundId);
    if (round.status === 'OPEN') {
      throw new NotFoundException({
        code: 'ROUND_NOT_TERMINAL',
        message: 'A round can only be verified once it is finished.',
      });
    }
    return {
      roundId: round.id,
      gameType: round.gameType,
      gameVersion: round.gameVersion,
      serverSeed: round.serverSeed,
      serverSeedHash: round.serverSeedHash,
      clientSeed: round.clientSeed,
      nonce: round.nonce,
      commitmentValid: this.fairness.verifyCommitment(round.serverSeed, round.serverSeedHash),
      revealedState: round.privateState,
      publicState: round.publicState,
    };
  }

  /** User-owned preferences. Unknown/deprecated registry ids are never emitted. */
  async favorites(userId: string) {
    const favorites = await this.prisma.casinoGameFavorite.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { gameId: true, createdAt: true },
    });
    return {
      games: await this.withAvailability(favorites
        .map((favorite) => {
          const game = this.registry.findById(favorite.gameId);
          return game ? { ...game, favoritedAt: favorite.createdAt } : null;
        })
        .filter((game): game is NonNullable<typeof game> => game !== null)),
    };
  }

  /** Idempotent by the `(userId, gameId)` database uniqueness constraint. */
  async addFavorite(userId: string, gameId: string) {
    const game = this.registry.require(gameId);
    const favorite = await this.prisma.casinoGameFavorite.upsert({
      where: { userId_gameId: { userId, gameId: game.id } },
      create: { userId, gameId: game.id },
      update: {},
    });
    return { game, favorite: true, favoritedAt: favorite.createdAt };
  }

  /** Removing an absent favorite is deliberately a successful no-op. */
  async removeFavorite(userId: string, gameId: string) {
    const game = this.registry.require(gameId);
    const removed = await this.prisma.casinoGameFavorite.deleteMany({
      where: { userId, gameId: game.id },
    });
    return { gameId: game.id, favorite: false, removed: removed.count > 0 };
  }

  /** Distinct games the player has actually played, most recent first. */
  async recent(userId: string, limit: number) {
    // DISTINCT ON chooses the newest occurrence per canonical id in the
    // database before LIMIT is applied. In particular, slot rounds derive the
    // concrete `fools-gold-rush` id from public state instead of collapsing all
    // future slots into the broad SLOTS enum.
    const games = await this.prisma.$queryRaw<{
      gameId: string;
      lastPlayedAt: Date;
    }[]>(Prisma.sql`
      SELECT recent."gameId", recent."createdAt" AS "lastPlayedAt"
      FROM (
        SELECT DISTINCT ON (derived."gameId")
          derived."gameId", derived."createdAt", derived."id"
        FROM (
          SELECT
            CASE
              WHEN "gameType" = 'SLOTS'::"CasinoGameType"
                THEN COALESCE(NULLIF("publicState"->>'gameId', ''), '')
              ELSE lower("gameType"::text)
            END AS "gameId",
            "createdAt",
            "id"
          FROM "CasinoRound"
          WHERE "userId" = ${userId}::uuid
        ) AS derived
        WHERE derived."gameId" <> ''
        ORDER BY derived."gameId", derived."createdAt" DESC, derived."id" DESC
      ) AS recent
      ORDER BY recent."createdAt" DESC, recent."id" DESC
      LIMIT ${limit}
    `);
    return {
      games: await this.withAvailability(games
        .map((recent) => {
          const entry = this.registry.findById(recent.gameId);
          return entry ? { ...entry, lastPlayedAt: recent.lastPlayedAt } : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null)),
    };
  }
}
