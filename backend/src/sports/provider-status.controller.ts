import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { AccessGuard } from '../auth/access.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SportsService } from './sports.service';
@Controller('admin/providers/sports') @UseGuards(AccessGuard, RolesGuard) @Roles(Role.ADMIN)
export class ProviderStatusController {
  constructor(private readonly sports: SportsService) {}
  @Get('status') status() { return this.sports.status(); }
}
