import { Body, Controller, Post, Res, UseGuards, UsePipes } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import {
  ACCESS_TOKEN_COOKIE,
  loginSchema,
  mfaVerifyInputSchema,
  registerSchema,
  type AuthPrincipal,
  type AuthTokens,
  type LoginInput,
  type MfaVerifyInput,
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
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(@Body() body: RegisterInput, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.register(body);
    this.setSessionCookie(res, tokens);
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
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(@Body() body: LoginInput, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.auth.login(body);
    this.setSessionCookie(res, tokens);
    return tokens;
  }

  // Unauthenticated on purpose: sign-out must succeed even if the access
  // token is already expired or the cookie is missing.
  @Post('logout')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(ACCESS_TOKEN_COOKIE, { path: '/' });
    return { ok: true };
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
  mfaVerify(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(mfaVerifyInputSchema)) body: MfaVerifyInput,
  ) {
    return this.auth.mfaVerify(user.userId, body.code);
  }

  private setSessionCookie(res: Response, tokens: AuthTokens) {
    res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: tokens.expiresIn * 1000,
    });
  }
}
