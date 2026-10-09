import { Body, Controller, Get, Header, Post, Req, UseGuards } from '@nestjs/common';
import { IsString, Length } from 'class-validator';
import { RATE_LIMITS, RateLimitService } from '../common/rate-limit.service';
import { AccessGuard, AuthenticatedRequest } from './access.guard';
import { MfaService } from './mfa.service';

class EnableDto {
  @IsString() @Length(6, 6) code!: string;
}

/** Self-service enrolment for the signed-in administrator. Only the AccessGuard applies, by design. */
@Controller('auth/2fa')
@UseGuards(AccessGuard)
export class MfaController {
  constructor(private readonly mfa: MfaService, private readonly limits: RateLimitService) {}

  @Get('status')
  status(@Req() request: AuthenticatedRequest) {
    return this.mfa.status(request.actor.id);
  }

  @Post('setup')
  @Header('Cache-Control', 'no-store')
  async setup(@Req() request: AuthenticatedRequest) {
    await this.limits.consume('mfa-setup', request.actor.id, RATE_LIMITS.admin);
    return this.mfa.beginSetup(request.actor.id);
  }

  @Post('enable')
  @Header('Cache-Control', 'no-store')
  async enable(@Req() request: AuthenticatedRequest, @Body() body: EnableDto) {
    await this.limits.consume('mfa-setup', request.actor.id, RATE_LIMITS.admin);
    return { recoveryCodes: await this.mfa.enable(request.actor.id, body.code) };
  }
}
