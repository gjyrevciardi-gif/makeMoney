import { Controller, Get, UseGuards } from '@nestjs/common';
import { AccessGuard } from '../auth/access.guard';
import { Capabilities } from '../auth/capabilities.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SportsService } from './sports.service';
@Controller('admin/providers/sports') @UseGuards(AccessGuard, RolesGuard) @Capabilities('PLATFORM_MANAGE')
export class ProviderStatusController {
  constructor(private readonly sports: SportsService) {}
  @Get('status') status() { return this.sports.status(); }
}
