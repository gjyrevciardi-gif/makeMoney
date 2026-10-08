import { Module } from '@nestjs/common';
import { RedisService } from '../common/redis.service';
import { PrismaService } from '../prisma.service';
import { AccessGuard } from '../auth/access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SPORTS_PROVIDER } from './domain';
import { OperationsHealthModule } from '../operations/operations-health.module';
import { ProviderStatusController } from './provider-status.controller';
import { SportsController } from './sports.controller';
import { SportsService } from './sports.service';
import { TheOddsApiProvider } from './the-odds-api.provider';
import { ApiFootballProvider } from './api-football.provider';
import { SportsProviderRouter } from './sports-provider.router';
import { JwtModule } from '@nestjs/jwt';
// SPORTS_PROVIDER now resolves to the router rather than to The Odds API
// directly. Everything downstream — SportsService, the controllers, bet
// placement — still talks to one SportsProvider and is unchanged; the router
// alone decides which upstream serves each request.
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }), OperationsHealthModule], controllers: [SportsController, ProviderStatusController], providers: [SportsService, TheOddsApiProvider, ApiFootballProvider, SportsProviderRouter, RedisService, PrismaService, AccessGuard, RolesGuard, { provide: SPORTS_PROVIDER, useExisting: SportsProviderRouter }], exports: [SportsService, SportsProviderRouter] })
export class SportsModule {}
