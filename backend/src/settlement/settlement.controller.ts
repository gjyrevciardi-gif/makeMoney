import { Controller, Post, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessGuard } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SettlementWorker } from './settlement.worker';
@Controller('admin/sports/settlement') @UseGuards(AccessGuard, RolesGuard) @Roles(Role.ADMIN)
export class SettlementController { constructor(private readonly worker: SettlementWorker) {} @Post('run') run() { return this.worker.runScheduledCycle(); } }
