import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AccessGuard } from '../auth/access.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RateLimitService } from '../common/rate-limit.service';
import { PrismaService } from '../prisma.service';
import { SettlementModule } from '../settlement/settlement.module';
import { OperationsHealthModule } from './operations-health.module';
import { SportsOperationsController } from './sports-operations.controller';
import { SportsOperationsService } from './sports-operations.service';

@Module({
  imports: [
    JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
    SettlementModule,
    OperationsHealthModule,
  ],
  controllers: [SportsOperationsController],
  providers: [
    SportsOperationsService,
    PrismaService,
    RateLimitService,
    AccessGuard,
    RolesGuard,
  ],
  exports: [SportsOperationsService],
})
export class SportsOperationsModule {}
