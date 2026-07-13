import { Body, Controller, Get, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE,
  loginSchema,
  mfaVerifyInputSchema,
  passwordResetCompleteSchema,
  passwordResetRequestSchema,
  refreshInputSchema,
  registerSchema,
  type AuthPrincipal,
  type AuthTokens,
  type LoginInput,
  type MfaVerifyInput,
  type PasswordResetCompleteInput,
  type PasswordResetRequestInput,
  type RefreshInput,
  type RegisterInput,
} from '@vpsy/contracts';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { AuthService } from './auth.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // Abuse-sensitive, unauthenticated routes (doc 04-api-design.md §9): keyed
  // by IP (no principal exists yet), tightened well below the 100/min global
  // default so credential-stuffing / account-creation floods are bounded.
  @Post('register')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async register(
    @Body(new ZodValidationPipe(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.register(body, this.sessionMetadata(req));
    this.setSessionCookies(res, tokens);
    return tokens;
  }

  // The body still carries accessToken/refreshToken (doc 06 §3 backward
  // compatibility — scripts/smoke.sh and any API/script client authenticate
  // with `Authorization: Bearer` and MUST keep working). The browser client
  // (apps/web/src/lib/api.ts) ignores those fields and relies solely on the
  // httpOnly cookie set below + the non-sensitive `principal` summary.
  // 20/min per IP: bounds credential-stuffing floods while not throttling a
  // whole clinic that shares one public IP behind NAT (5/min was too tight for
  // multi-staff sites). Stronger per-ACCOUNT lockout is a tracked follow-up.
  @Post('login')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(body, this.sessionMetadata(req));
    this.setSessionCookies(res, tokens);
    return tokens;
  }

  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async refresh(
    @Body(new ZodValidationPipe(refreshInputSchema)) body: RefreshInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = body.refreshToken ?? this.readCookie(req, REFRESH_TOKEN_COOKIE);
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');
    const tokens = await this.auth.refresh(refreshToken, this.sessionMetadata(req));
    this.setSessionCookies(res, tokens);
    return tokens;
  }

  // Unauthenticated on purpose: sign-out must succeed even if the access
  // token is already expired or the cookie is missing.
  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async logout(
    @Body() body: { refreshToken?: unknown } | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const bodyToken = typeof body?.refreshToken === 'string' ? body.refreshToken : undefined;
    await this.auth.logout(bodyToken ?? this.readCookie(req, REFRESH_TOKEN_COOKIE));
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return { ok: true };
  }

  // ── Password reset (doc 06 §3 account recovery) ──
  @Post('password-reset/request')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema)) body: PasswordResetRequestInput,
    @Req() req: Request,
  ) {
    return this.auth.requestPasswordReset(body, this.sessionMetadata(req));
  }

  @Post('password-reset/complete')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  completePasswordReset(
    @Body(new ZodValidationPipe(passwordResetCompleteSchema)) body: PasswordResetCompleteInput,
    @Req() req: Request,
  ) {
    return this.auth.completePasswordReset(body, this.sessionMetadata(req));
  }

  // ── MFA / TOTP (doc 06-security-and-rbac.md §3) ──

  // Enrollment only generates + stores the secret; it does NOT enable MFA —
  // see AuthService#mfaEnroll for why (avoids a half-scanned QR locking a
  // user out or silently starting to be enforced).
  // Body optionally carries a current `code` — REQUIRED to rotate an already-
  // enabled MFA (proof of possession; see AuthService#mfaEnroll). Ignored for a
  // first-time enrollment.
  @Post('mfa/enroll')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  mfaEnroll(@CurrentUser() user: AuthPrincipal, @Body() body?: { code?: string }) {
    return this.auth.mfaEnroll(user.userId, body?.code);
  }

  @Post('mfa/verify')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async mfaVerify(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(mfaVerifyInputSchema)) body: MfaVerifyInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.mfaVerify(user.userId, body.code, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    this.setSessionCookies(res, tokens);
    return tokens;
  }

  /** Active refresh sessions for the signed-in user (device inventory). */
  @Get('sessions')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  listSessions(@CurrentUser() user: AuthPrincipal) {
    return this.auth.listSessions(user);
  }

  /**
   * Revoke all refresh sessions for the current user (sign out everywhere).
   * Clears cookies on this browser; other devices fail at next access check.
   */
  @Post('sessions/revoke-all')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  async revokeAllSessions(
    @CurrentUser() user: AuthPrincipal,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.revokeAllSessions(user);
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_TOKEN_COOKIE, { path: '/' });
    return result;
  }

  private setSessionCookies(res: Response, tokens: AuthTokens) {
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: tokens.expiresIn * 1000,
    });
    res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      // The browser may reach the API through a reverse-proxy prefix such as
      // /api/backend/auth; cookie scope must not assume the API's internal path.
      path: '/',
      maxAge: (tokens.refreshExpiresIn ?? 30 * 24 * 60 * 60) * 1000,
    });
  }

  private readCookie(req: Request, name: string): string | undefined {
    const header = req.headers.cookie;
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const index = part.indexOf('=');
      if (index < 0 || part.slice(0, index).trim() !== name) continue;
      try {
        return decodeURIComponent(part.slice(index + 1).trim());
      } catch {
        return undefined;
      }
    }
    return undefined;
  }

  private sessionMetadata(req: Request) {
    const userAgent = req.headers['user-agent'];
    return { ip: req.ip, userAgent: typeof userAgent === 'string' ? userAgent : undefined };
  }
}
