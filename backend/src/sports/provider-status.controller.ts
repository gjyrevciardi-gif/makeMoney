import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessGuard } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SportsService } from './sports.service';
import { SportsProviderRouter } from './sports-provider.router';
@Controller('admin/providers/sports') @UseGuards(AccessGuard, RolesGuard) @Roles(Role.ADMIN)
export class ProviderStatusController {
  constructor(private readonly sports: SportsService, private readonly router: SportsProviderRouter) {}
  /** Unchanged shape, so the existing dashboard row keeps working. */
  @Get('status') status() { return this.sports.status(); }
  /**
   * Both providers side by side (§8): configured, last success, last error,
   * quota, and for API-Football whether a request was refused for plan reasons.
   * No key can appear here — ProviderStatus has no field for one, and the
   * config module is the only place a key is ever read.
   */
  @Get('providers') providers() { return { providers: this.router.getStatuses() }; }
}
