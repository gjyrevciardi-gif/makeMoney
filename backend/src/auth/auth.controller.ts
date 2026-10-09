import { Body, Controller, ForbiddenException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsOptional, IsString, Length, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { RateLimitService, RATE_LIMITS } from '../common/rate-limit.service';
import { requestIp } from '../common/http';

// Registration (when enabled) still takes an email; accounts are normally created by an administrator.
class CredentialsDto { @IsEmail() email!: string; @IsString() @MinLength(8) @MaxLength(128) password!: string; }
/** A username or an email address. `email` is accepted as the legacy name for the same field. */
class LoginDto {
  @ValidateIf((body: LoginDto) => body.email === undefined) @IsString() @Length(1, 254) identifier?: string;
  @ValidateIf((body: LoginDto) => body.identifier === undefined) @IsOptional() @IsString() @Length(1, 254) email?: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
class MfaLoginDto { @IsString() @Length(20, 2000) mfaToken!: string; @IsString() @Length(6, 20) code!: string; }
const COOKIE = 'refresh_token';
const secureCookies = process.env.COOKIE_SECURE !== 'false';
const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'strict' as const, path: '/auth', maxAge: 30 * 86400_000 };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly limits: RateLimitService, private readonly mfa: MfaService) {}
  @Post('register') async register(@Body() body: CredentialsDto, @Req() request: Request) {
    // Off unless explicitly enabled: accounts are created by an administrator.
    if (process.env.REGISTRATION_ENABLED !== 'true') throw new ForbiddenException('REGISTRATION_DISABLED');
    await this.limits.consume('register', requestIp(request), RATE_LIMITS.register);
    return this.auth.register(body.email, body.password);
  }
  @Post('login') async login(@Body() body: LoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const identifier = (body.identifier ?? body.email ?? '').trim().toLowerCase();
    const key = `${requestIp(request)}:${identifier}`;
    await this.limits.assertAllowed('login', key, RATE_LIMITS.loginFailures);
    let user;
    try { user = await this.auth.verifyCredentials(identifier, body.password); }
    catch (error) { if (error instanceof UnauthorizedException) await this.limits.consume('login', key, RATE_LIMITS.loginFailures); throw error; }
    await this.limits.reset('login', key);
    // Administrators with Google Authenticator on get a challenge instead of a session.
    if (await this.mfa.isEnabled(user.id)) return { mfaRequired: true, mfaToken: await this.auth.issueMfaChallenge(user.id) };
    const result = await this.auth.startSessionFor(user.id);
    response.cookie(COOKIE, result.pair.refreshToken, cookieOptions);
    return { accessToken: result.pair.accessToken, user: result.user };
  }
  @Post('login/2fa') async loginSecondFactor(@Body() body: MfaLoginDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const userId = await this.auth.readMfaChallenge(body.mfaToken);
    const key = `${requestIp(request)}:${userId}`;
    await this.limits.assertAllowed('mfa', key, RATE_LIMITS.loginFailures);
    try { await this.mfa.verifyLogin(userId, body.code); }
    catch (error) { if (error instanceof UnauthorizedException) await this.limits.consume('mfa', key, RATE_LIMITS.loginFailures); throw error; }
    await this.limits.reset('mfa', key);
    const result = await this.auth.startSessionFor(userId);
    response.cookie(COOKIE, result.pair.refreshToken, cookieOptions);
    return { accessToken: result.pair.accessToken, user: result.user };
  }
  @Post('refresh') async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.limits.consume('refresh', requestIp(request), RATE_LIMITS.refresh);
    const pair = await this.auth.rotateRefreshToken((request.cookies?.[COOKIE] as string | undefined) ?? '');
    response.cookie(COOKIE, pair.refreshToken, cookieOptions);
    return { accessToken: pair.accessToken };
  }
  @Post('logout') async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.auth.revokeFamily(request.cookies?.[COOKIE] as string | undefined);
    response.clearCookie(COOKIE, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/auth' });
    return { success: true };
  }
}
