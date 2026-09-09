import { Module } from '@nestjs/common';
import { AdminController } from './admin/admin.controller';
import { AuthController } from './auth/auth.controller';
import { AuthService } from './auth/auth.service';
import { PrismaService } from './prisma.service';
import { PointsService } from './wallet/points.service';
import { JwtModule } from '@nestjs/jwt';
import { AccessGuard } from './auth/access.guard';
import { RolesGuard } from './auth/roles.guard';
import { PrivateController } from './users/private.controller';
import { RedisService } from './common/redis.service';
import { RateLimitService } from './common/rate-limit.service';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { SafeExceptionFilter } from './common/safe-exception.filter';
import { BigIntInterceptor } from './common/bigint.interceptor';
import { SportsModule } from './sports/sports.module';
import { BetsModule } from './bets/bets.module';
import { SettlementModule } from './settlement/settlement.module';
import { SportsOperationsModule } from './operations/sports-operations.module';
import { CasinoModule } from './casino/casino.module';
import { ProductionHealthController } from './operations/production-health.controller';
import { RequestLoggingInterceptor } from './common/request-logging.interceptor';
import { RequestIdMiddleware } from './common/request-id.middleware';
import { MiddlewareConsumer, NestModule } from '@nestjs/common';

@Module({
  imports: [JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }), SportsModule, BetsModule, SettlementModule, SportsOperationsModule, CasinoModule],
  controllers: [AuthController, AdminController, PrivateController, ProductionHealthController],
  providers: [PrismaService, AuthService, PointsService, AccessGuard, RolesGuard, RedisService, RateLimitService, RequestIdMiddleware, { provide: APP_INTERCEPTOR, useClass: BigIntInterceptor }, { provide: APP_INTERCEPTOR, useClass: RequestLoggingInterceptor }, { provide: APP_FILTER, useClass: SafeExceptionFilter }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
