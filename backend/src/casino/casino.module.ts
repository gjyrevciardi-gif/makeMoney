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

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET })],
  controllers: [
    CasinoController,
    CasinoAdminController,
    CasinoConfigController,
    PlatformSettingsController,
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
  ],
  exports: [
    CasinoService,
    CasinoRoundService,
    CasinoFairnessService,
    CasinoConfigService,
    CasinoAdminService,
    CrashService,
    CasinoClock,
  ],
})
export class CasinoModule {}
