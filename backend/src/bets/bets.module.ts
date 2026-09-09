import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessGuard } from '../auth/access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma.service';
import { SportsModule } from '../sports/sports.module';
import { CasinoModule } from '../casino/casino.module';
import { BetsController } from './bets.controller';
import { BetsService } from './bets.service';
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }), SportsModule, CasinoModule], controllers: [BetsController], providers: [BetsService, PrismaService, RedisService, RateLimitService, AccessGuard, RolesGuard] })
export class BetsModule {}
