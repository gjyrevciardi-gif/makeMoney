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
import { JwtModule } from '@nestjs/jwt';
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }), OperationsHealthModule], controllers: [SportsController, ProviderStatusController], providers: [SportsService, TheOddsApiProvider, RedisService, PrismaService, AccessGuard, RolesGuard, { provide: SPORTS_PROVIDER, useExisting: TheOddsApiProvider }], exports: [SportsService] })
export class SportsModule {}
