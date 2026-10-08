import { ClassicController } from './games/book-of-ra-classic/classic.controller';
import { ClassicAdapter, CLASSIC_OPTIONS } from './games/book-of-ra-classic/classic.adapter';
import { ClassicMathAdapter } from './games/book-of-ra-classic/classic.math-adapter';
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessGuard } from '../auth/access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma.service';
import { CasinoAdminController } from './casino-admin.controller';
import { CasinoConfigService } from './casino-config.service';
import {
  CasinoConfigController,
  PlatformSettingsController,
} from './casino-config.controller';
import { CasinoAdminService } from './casino-admin.service';
import { CasinoController } from './casino.controller';
import { CasinoFairnessService } from './casino-fairness.service';
import { CasinoGameRegistry } from './casino-game.registry';
import { CasinoRoundService } from './casino-round.service';
import { CasinoService } from './casino.service';
import { DiceService } from './games/dice/dice.service';
import { MinesService } from './games/mines/mines.service';
import { RouletteService } from './games/roulette/roulette.service';
import { BlackjackService } from './games/blackjack/blackjack.service';
import { CrashService } from './games/crash/crash.service';
import { CrashSettlementWorker } from './games/crash/crash-settlement.worker';
import { PlinkoService } from './games/plinko/plinko.service';
import { CasinoClock } from './casino-clock.service';
import { SlotsService } from './games/slots/slots.service';
import { TumbleSlotsService } from './games/slots/tumble.service';
import { LuckyLadyController } from './games/lucky-lady/lucky-lady.controller';
import { LUCKY_LADY_OPTIONS, LuckyLadyAdapter } from './games/lucky-lady/lucky-lady.adapter';
import { GameCapabilityService } from './platform/game-capability.service';
import { GameJournalService } from './platform/game-journal.service';
import { GameRoundService } from './platform/game-round.service';
import { GameWalletService } from './platform/game-wallet.service';
import { MathControlController } from './platform/math-control/math-control.controller';
import { GameMathRegistry } from './platform/math-control/math-control.registry';
import { MathControlService } from './platform/math-control/math-control.service';
import { MathControlJobs } from './platform/math-control/math-control.jobs';
import { LuckyLadyPayoutController } from './games/lucky-lady/payout/lucky-lady-payout.controller';
import { LuckyLadyPayoutService } from './games/lucky-lady/payout/lucky-lady-payout.service';
import { LuckyLadyMathAdapter } from './games/lucky-lady/lucky-lady.math-adapter';
import { GAME_MATH_ADAPTERS, GAME_MATH_DEFAULT_RESETTERS } from './platform/math-control/math-control.types';
import {
  GAME_AVAILABILITY,
  GAME_PLATFORM,
  GAME_PLAYABILITY,
} from './platform/game-adapter.types';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET })],
  controllers: [
    CasinoController,
    CasinoAdminController,
    CasinoConfigController,
    PlatformSettingsController,
    LuckyLadyController,
    ClassicController,
    MathControlController,
    LuckyLadyPayoutController,
  ],
  providers: [
    PrismaService,
    RedisService,
    RateLimitService,
    AccessGuard,
    RolesGuard,
    CasinoFairnessService,
    CasinoRoundService,
    CasinoConfigService,
    CasinoGameRegistry,
    CasinoService,
    CasinoAdminService,
    DiceService,
    MinesService,
    RouletteService,
    BlackjackService,
    CasinoClock,
    CrashService,
    CrashSettlementWorker,
    PlinkoService,
    SlotsService,
    TumbleSlotsService,
    // ---- Reusable game-integration layer (shared by every integrated game) ----
    { provide: GAME_AVAILABILITY, useExisting: CasinoGameRegistry },
    { provide: GAME_PLAYABILITY, useExisting: CasinoConfigService },
    GameCapabilityService,
    GameWalletService,
    GameJournalService,
    GameRoundService,
    {
      provide: GAME_PLATFORM,
      useFactory: (
        capabilities: GameCapabilityService,
        wallet: GameWalletService,
        journal: GameJournalService,
        rounds: GameRoundService,
      ) => ({ capabilities, wallet, journal, rounds }),
      inject: [GameCapabilityService, GameWalletService, GameJournalService, GameRoundService],
    },
    // ---- Adapter #1: Lucky Lady's Charm Deluxe ----
    LuckyLadyAdapter,
    ClassicAdapter,
    { provide: CLASSIC_OPTIONS, useValue: {} },
    // Production defaults: OS CSPRNG draws, no test RNG or failure hooks.
    { provide: LUCKY_LADY_OPTIONS, useValue: {} },
    // ---- Game Math Control (shared lifecycle, per-game mathematics) ----
    LuckyLadyMathAdapter,
    ClassicMathAdapter,
    {
      provide: GAME_MATH_ADAPTERS,
      useFactory: (luckyLady: LuckyLadyMathAdapter, classic: ClassicMathAdapter) => [luckyLady, classic],
      inject: [LuckyLadyMathAdapter, ClassicMathAdapter],
    },
    // Games whose default state is owned by their own admin panel register one
    // DEFAULT-reset delegate. Lucky Lady's payout panel keeps that ownership:
    // the generic route reuses its transaction, history row and distribution
    // clearing instead of duplicating them, and the legacy panel route is
    // unchanged.
    {
      provide: GAME_MATH_DEFAULT_RESETTERS,
      useFactory: (payout: LuckyLadyPayoutService) => [payout],
      inject: [LuckyLadyPayoutService],
    },
    GameMathRegistry,
    MathControlJobs,
    MathControlService,
    LuckyLadyPayoutService,
  ],
  exports: [
    GAME_PLATFORM,
    GameCapabilityService,
    GameWalletService,
    GameJournalService,
    GameRoundService,
    CasinoService,
    CasinoRoundService,
    CasinoFairnessService,
    CasinoConfigService,
    CasinoAdminService,
    MathControlService,
    LuckyLadyPayoutService,
    GameMathRegistry,
    MathControlJobs,
    CrashService,
    CasinoClock,
  ],
})
export class CasinoModule {}
