import { Controller, Post, UseGuards } from '@nestjs/common';
import { AccessGuard } from '../auth/access.guard';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SettlementWorker } from './settlement.worker';
@Controller('admin/sports/settlement') @UseGuards(AccessGuard, RolesGuard) @Capabilities('PLATFORM_MANAGE')
export class SettlementController { constructor(private readonly worker: SettlementWorker) {} @Post('run') run() { return this.worker.runScheduledCycle(); } }
