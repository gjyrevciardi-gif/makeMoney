import { Module } from '@nestjs/common';
import { OperationsHealthModule } from '../operations/operations-health.module';
import { JwtModule } from '@nestjs/jwt';
import { AccessGuard } from '../auth/access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { PrismaService } from '../prisma.service';
import { SPORTS_RESULT_PROVIDER } from './result-provider';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';
import { SettlementWorker } from './settlement.worker';
import { TheOddsApiResultProvider } from './the-odds-api-result.provider';
@Module({ imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }), OperationsHealthModule], controllers: [SettlementController], providers: [PrismaService, AccessGuard, RolesGuard, SettlementService, SettlementWorker, TheOddsApiResultProvider, { provide: SPORTS_RESULT_PROVIDER, useExisting: TheOddsApiResultProvider }], exports: [SettlementService] })
export class SettlementModule {}
