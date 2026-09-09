import { Module } from '@nestjs/common';
import { RedisService } from '../common/redis.service';
import { OperationsHealthService } from './operations-health.service';

@Module({
  providers: [RedisService, OperationsHealthService],
  exports: [RedisService, OperationsHealthService],
})
export class OperationsHealthModule {}
