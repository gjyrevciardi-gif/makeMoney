import { Body, Controller, ForbiddenException, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { AuthService } from './auth.service';
import { RateLimitService, RATE_LIMITS } from '../common/rate-limit.service';
import { requestIp } from '../common/http';

class CredentialsDto { @IsEmail() email!: string; @IsString() @MinLength(12) password!: string; }
const COOKIE = 'refresh_token';
const secureCookies = process.env.COOKIE_SECURE !== 'false';
const cookieOptions = { httpOnly: true, secure: secureCookies, sameSite: 'strict' as const, path: '/auth', maxAge: 30 * 86400_000 };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly limits: RateLimitService) {}
  @Post('register') async register(@Body() body: CredentialsDto, @Req() request: Request) {
    if (process.env.REGISTRATION_ENABLED === 'false') throw new ForbiddenException('REGISTRATION_DISABLED');
    await this.limits.consume('register', requestIp(request), RATE_LIMITS.register);
    return this.auth.register(body.email, body.password);
  }
  @Post('login') async login(@Body() body: CredentialsDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const key = `${requestIp(request)}:${body.email.trim().toLowerCase()}`;
    await this.limits.assertAllowed('login', key, RATE_LIMITS.loginFailures);
    let result;
    try { result = await this.auth.login(body.email, body.password); }
    catch (error) { if (error instanceof UnauthorizedException) await this.limits.consume('login', key, RATE_LIMITS.loginFailures); throw error; }
    await this.limits.reset('login', key);
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
