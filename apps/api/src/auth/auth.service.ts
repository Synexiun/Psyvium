import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AuthTokens,
  LoginInput,
  MfaEnrollResponse,
  PasswordResetCompleteInput,
  PasswordResetRequestInput,
  RegisterInput,
} from '@vpsy/contracts';
import { MFA_MANDATORY_ROLES, MfaErrorCode, ROLE_PERMISSIONS, Role } from '@vpsy/contracts';
import { Prisma } from '@vpsy/database';
import * as argon2 from 'argon2';
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { generateSecret as generateTotpSecret, generateURI as generateTotpURI, verify as verifyTotp } from 'otplib';
import { AuditService } from '../common/audit/audit.service';
import { jwtAccessSecret, jwtRefreshSecret } from '../common/config/jwt-secrets';
import { FieldCipherService } from '../common/crypto/field-cipher';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/prisma/tenant-context';

const TOTP_ISSUER = 'VPSY OS';
const SELF_REGISTRATION_ROLE: Role = Role.CLIENT;
const ACTIVE_TENANT_STATUS = 'active';
const DEFAULT_ACCESS_TTL_SECONDS = 15 * 60;
const DEFAULT_REFRESH_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface SessionMetadata {
  ip?: string;
  userAgent?: string;
}

interface TokenUser {
  id: string;
  tenantId: string;
  authVersion: number;
  status: string;
  deletedAt: Date | null;
  mfaEnabled: boolean;
  mfaRecoveryHashes?: unknown;
  failedLoginCount?: number;
  lockedUntil?: Date | null;
  tenant: { status: string };
  roleAssignments: Array<{
    clinicId: string | null;
    jurisdiction: string | null;
    role: {
      name: string;
      permissions: Array<{ permission: { key: string } }>;
    };
  }>;
}

function requiresMfaEnrollment(roles: string[], mfaEnabled: boolean): boolean {
  if (mfaEnabled) return false;
  return roles.some((role) => (MFA_MANDATORY_ROLES as readonly string[]).includes(role));
}

interface RefreshClaims {
  sub: string;
  tenantId: string;
  typ: 'refresh';
  sid: string;
  fid: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function positiveTtl(envName: string, fallback: number): number {
  const parsed = Number(process.env[envName] ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function digestToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

function constantTimeHexEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    private readonly cipher: FieldCipherService,
  ) {}

  /**
   * Tenant-aware public onboarding. Registration is possible only for an
   * active tenant that explicitly opted in. Omitting tenantSlug is safe only
   * in a deployment with exactly one eligible tenant; ambiguity is rejected.
   * User, CLIENT assignment, and Client aggregate are one transaction.
   */
  async register(input: RegisterInput, metadata: SessionMetadata = {}): Promise<AuthTokens> {
    const tenant = await this.resolveRegistrationTenant(input.tenantSlug);
    const role = await this.prisma.role.findUniqueOrThrow({ where: { name: SELF_REGISTRATION_ROLE } });
    const hashedPassword = await argon2.hash(input.password);
    const email = normalizeEmail(input.email);

    let userId: string;
    try {
      userId = await TenantContext.run({ tenantId: tenant.id }, () =>
        this.prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email,
              fullName: input.fullName.trim(),
              hashedPassword,
              locale: input.locale,
              timezone: input.timezone,
            },
          });
          await tx.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
          await tx.client.create({
            data: {
              userId: user.id,
              tenantId: tenant.id,
              preferredLanguage: input.locale,
            },
          });
          return user.id;
        }),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('An account with this email already exists for this tenant');
      }
      throw error;
    }

    return TenantContext.run({ tenantId: tenant.id }, async () => {
      const tokens = await this.issueTokens(userId, metadata);
      await this.audit.record({
        tenantId: tenant.id,
        actorId: userId,
        action: 'user.registered',
        entityType: 'User',
        entityId: userId,
        after: { email, role: SELF_REGISTRATION_ROLE },
      });
      return tokens;
    });
  }

  async login(input: LoginInput, metadata: SessionMetadata = {}): Promise<AuthTokens> {
    const email = normalizeEmail(input.email);
    const users = await this.prisma.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        status: 'ACTIVE',
        tenant: {
          status: ACTIVE_TENANT_STATUS,
          ...(input.tenantSlug ? { slug: input.tenantSlug } : {}),
        },
      },
      take: 2,
    });

    // Never choose the first row for a cross-tenant email. This is deliberately
    // the same response as bad credentials to avoid tenant/account enumeration.
    if (users.length !== 1) throw new UnauthorizedException('Invalid credentials');
    const user = users[0]!;

    // Progressive lockout after failed password attempts (doc 06).
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException('Account temporarily locked — try again later');
    }

    const passwordValid = await argon2.verify(user.hashedPassword, input.password);
    if (!passwordValid) {
      const failures = (user.failedLoginCount ?? 0) + 1;
      const lockAfter = 5;
      const data: { failedLoginCount: number; lockedUntil?: Date } = { failedLoginCount: failures };
      if (failures >= lockAfter) {
        data.lockedUntil = new Date(Date.now() + 15 * 60_000);
      }
      await this.prisma.user.update({ where: { id: user.id }, data });
      throw new UnauthorizedException('Invalid credentials');
    }

    if ((user.failedLoginCount ?? 0) > 0 || user.lockedUntil) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    }

    let migratedSecret: string | undefined;
    let consumedRecoveryHashes: string[] | undefined;
    if (user.mfaEnabled) {
      if (!input.totp) {
        throw new UnauthorizedException({ code: MfaErrorCode.MFA_REQUIRED, message: 'MFA code required' });
      }
      const presented = input.totp.trim();
      // Recovery codes are 12-char alphanumerics; TOTP is 6 digits.
      if (presented.length > 6) {
        const hashes = Array.isArray(user.mfaRecoveryHashes)
          ? (user.mfaRecoveryHashes as string[])
          : [];
        const presentedHash = digestToken(presented.toLowerCase());
        const idx = hashes.findIndex((h) => constantTimeHexEqual(h, presentedHash));
        if (idx < 0) {
          throw new UnauthorizedException({ code: MfaErrorCode.MFA_INVALID, message: 'Invalid MFA code' });
        }
        consumedRecoveryHashes = hashes.filter((_, i) => i !== idx);
      } else {
        const secret = await this.decryptMfaSecret(user.mfaSecret, user.tenantId);
        const result = await verifyTotp({ secret, token: presented, epochTolerance: 30 });
        if (!result.valid) {
          throw new UnauthorizedException({ code: MfaErrorCode.MFA_INVALID, message: 'Invalid MFA code' });
        }
        // Lazy migration: once a legacy plaintext secret is successfully used,
        // seal it with the field key in the same update as lastLoginAt.
        const sealed = await this.cipher.encryptString(secret, user.tenantId);
        if (this.cipher.isActive && sealed && sealed !== user.mfaSecret) migratedSecret = sealed;
      }
    }

    return TenantContext.run({ tenantId: user.tenantId }, async () => {
      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(migratedSecret ? { mfaSecret: migratedSecret } : {}),
          ...(consumedRecoveryHashes
            ? { mfaRecoveryHashes: consumedRecoveryHashes }
            : {}),
        },
      });
      const tokens = await this.issueTokens(user.id, metadata);
      await this.audit.record({
        tenantId: user.tenantId,
        actorId: user.id,
        action: consumedRecoveryHashes ? 'user.login_mfa_recovery' : 'user.login',
        entityType: 'User',
        entityId: user.id,
        critical: Boolean(consumedRecoveryHashes),
      });
      return tokens;
    });
  }

  /** Rotate a refresh session exactly once. Reuse revokes its whole family. */
  async refresh(refreshToken: string, metadata: SessionMetadata = {}): Promise<AuthTokens> {
    const claims = await this.verifyRefreshToken(refreshToken);
    const presentedHash = digestToken(refreshToken);
    const now = new Date();

    const result = await TenantContext.run({ tenantId: claims.tenantId }, () =>
      this.prisma.$transaction(async (tx) => {
        const session = await tx.refreshSession.findUnique({
          where: { id: claims.sid },
          include: {
            user: {
              include: {
                tenant: true,
                roleAssignments: {
                  include: { role: { include: { permissions: { include: { permission: true } } } } },
                },
              },
            },
          },
        });

        const identityMismatch =
          !session ||
          session.userId !== claims.sub ||
          session.tenantId !== claims.tenantId ||
          session.familyId !== claims.fid ||
          !constantTimeHexEqual(session.tokenHash, presentedHash);

        if (identityMismatch || session?.revokedAt) {
          if (session) {
            await tx.refreshSession.updateMany({
              where: { tenantId: session.tenantId, userId: session.userId, familyId: session.familyId, revokedAt: null },
              data: { revokedAt: now },
            });
            await tx.user.update({ where: { id: session.userId }, data: { authVersion: { increment: 1 } } });
          }
          return { kind: 'reuse' as const, userId: session?.userId, tenantId: session?.tenantId };
        }

        if (session.expiresAt <= now) {
          await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: now } });
          return { kind: 'invalid' as const };
        }

        const user = session.user as unknown as TokenUser;
        if (!this.isActiveTokenUser(user)) {
          await tx.refreshSession.updateMany({
            where: { tenantId: session.tenantId, userId: session.userId, familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.user.update({ where: { id: session.userId }, data: { authVersion: { increment: 1 } } });
          return { kind: 'invalid' as const };
        }

        const nextId = randomUUID();
        const tokens = await this.signTokens(user, nextId, session.familyId);
        const claimed = await tx.refreshSession.updateMany({
          where: { id: session.id, tokenHash: presentedHash, revokedAt: null },
          data: { revokedAt: now, lastUsedAt: now, replacedById: nextId },
        });
        if (claimed.count !== 1) {
          await tx.refreshSession.updateMany({
            where: { tenantId: session.tenantId, userId: session.userId, familyId: session.familyId, revokedAt: null },
            data: { revokedAt: now },
          });
          await tx.user.update({ where: { id: session.userId }, data: { authVersion: { increment: 1 } } });
          return { kind: 'reuse' as const, userId: session.userId, tenantId: session.tenantId };
        }
        await tx.refreshSession.create({ data: this.sessionData(tokens, user, nextId, session.familyId, metadata) });
        return { kind: 'ok' as const, tokens, userId: user.id, tenantId: user.tenantId };
      }),
    );

    if (result.kind === 'reuse') {
      if (result.userId && result.tenantId) {
        await this.audit.record({
          tenantId: result.tenantId,
          actorId: result.userId,
          action: 'auth.refresh_reuse_detected',
          entityType: 'User',
          entityId: result.userId,
          critical: true,
        });
      }
      throw new UnauthorizedException('Refresh session has been revoked');
    }
    if (result.kind === 'invalid') throw new UnauthorizedException('Invalid or expired refresh token');

    await this.audit.record({
      tenantId: result.tenantId,
      actorId: result.userId,
      action: 'auth.session_refreshed',
      entityType: 'RefreshSession',
      entityId: claims.sid,
    });
    return result.tokens.public;
  }

  /** Revoke the current refresh/access pair. Safe and idempotent. */
  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    let claims: RefreshClaims;
    try {
      claims = await this.verifyRefreshToken(refreshToken, true);
    } catch {
      return;
    }
    const tokenHash = digestToken(refreshToken);
    const revoked = await TenantContext.run({ tenantId: claims.tenantId }, () =>
      this.prisma.refreshSession.updateMany({
        where: {
          id: claims.sid,
          userId: claims.sub,
          tenantId: claims.tenantId,
          tokenHash,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      }),
    );
    if (revoked.count > 0) {
      await this.audit.record({
        tenantId: claims.tenantId,
        actorId: claims.sub,
        action: 'user.logout',
        entityType: 'RefreshSession',
        entityId: claims.sid,
      });
    }
  }

  async mfaEnroll(userId: string, currentCode?: string): Promise<MfaEnrollResponse> {
    const user = await this.activeUserOrThrow(userId);
    if (user.mfaEnabled) {
      if (!currentCode) {
        throw new UnauthorizedException({
          code: MfaErrorCode.MFA_REQUIRED,
          message: 'MFA is already enabled — provide a valid current code to rotate it.',
        });
      }
      const currentSecret = await this.decryptMfaSecret(user.mfaSecret, user.tenantId);
      const proof = await verifyTotp({ secret: currentSecret, token: currentCode, epochTolerance: 30 });
      if (!proof.valid) {
        throw new UnauthorizedException({ code: MfaErrorCode.MFA_INVALID, message: 'Invalid current MFA code.' });
      }
    }

    const secret = generateTotpSecret();
    const sealed = await this.cipher.encryptString(secret, user.tenantId);
    await this.prisma.user.update({
      where: { id: user.id },
      // Keep an already-active secret in place until the new authenticator
      // proves possession. Abandoning rotation can therefore never lock out
      // the existing factor.
      data: { mfaPendingSecret: sealed ?? secret },
    });
    const otpauthUrl = generateTotpURI({ issuer: TOTP_ISSUER, label: user.email, secret });
    return { secret, otpauthUrl };
  }

  /**
   * Account recovery (doc 06 §3). Always returns the same shape so callers
   * cannot enumerate accounts. In non-production, `devResetToken` is included
   * so local demos work without an email provider.
   */
  async requestPasswordReset(
    input: PasswordResetRequestInput,
    metadata: SessionMetadata = {},
  ): Promise<{ ok: true; devResetToken?: string }> {
    const email = normalizeEmail(input.email);
    const users = await this.prisma.user.findMany({
      where: {
        email: { equals: email, mode: 'insensitive' },
        deletedAt: null,
        status: 'ACTIVE',
        tenant: {
          status: ACTIVE_TENANT_STATUS,
          ...(input.tenantSlug ? { slug: input.tenantSlug } : {}),
        },
      },
      take: 2,
    });

    // Ambiguous or missing identity → silent success (no enumeration).
    if (users.length !== 1) {
      return { ok: true };
    }
    const user = users[0]!;
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = digestToken(rawToken);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await TenantContext.run({ tenantId: user.tenantId }, async () => {
      // Invalidate outstanding unused tokens for this user.
      await this.prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await this.prisma.passwordResetToken.create({
        data: {
          tenantId: user.tenantId,
          userId: user.id,
          tokenHash,
          expiresAt,
          ipHash: metadata.ip
            ? createHmac('sha256', jwtRefreshSecret()).update(metadata.ip).digest('hex')
            : undefined,
        },
      });
      await this.audit.record({
        tenantId: user.tenantId,
        actorId: user.id,
        action: 'auth.password_reset_requested',
        entityType: 'User',
        entityId: user.id,
      });
    });

    // Production would email the token. Dev/test surfaces it once so QA works
    // without an SMTP provider. Never log the raw token in production logs.
    if (process.env.NODE_ENV === 'production') {
      this.logger.log(
        `Password reset requested for user ${user.id} (email delivery not configured — wire SMTP/SES next).`,
      );
      return { ok: true };
    }
    return { ok: true, devResetToken: rawToken };
  }

  async completePasswordReset(
    input: PasswordResetCompleteInput,
    metadata: SessionMetadata = {},
  ): Promise<{ ok: true }> {
    const presentedHash = digestToken(input.token);
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: presentedHash },
      include: { user: { include: { tenant: true } } },
    });
    if (
      !row ||
      row.usedAt ||
      row.expiresAt.getTime() <= Date.now() ||
      row.user.deletedAt ||
      row.user.status !== 'ACTIVE' ||
      row.user.tenant.status !== ACTIVE_TENANT_STATUS
    ) {
      throw new UnauthorizedException('Invalid or expired reset token');
    }

    const hashedPassword = await argon2.hash(input.newPassword);
    await TenantContext.run({ tenantId: row.tenantId }, async () => {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) {
          throw new UnauthorizedException('Invalid or expired reset token');
        }
        await tx.user.update({
          where: { id: row.userId },
          data: {
            hashedPassword,
            // Force all sessions offline after a credential change.
            authVersion: { increment: 1 },
          },
        });
        await tx.refreshSession.updateMany({
          where: { userId: row.userId, tenantId: row.tenantId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      });
      await this.audit.record({
        tenantId: row.tenantId,
        actorId: row.userId,
        action: 'auth.password_reset_completed',
        entityType: 'User',
        entityId: row.userId,
        ip: metadata.ip,
        userAgent: metadata.userAgent,
        critical: true,
      });
    });

    return { ok: true };
  }

  /**
   * Completes enrollment and re-issues tokens so `mfaEnrollmentRequired`
   * clears without a second login. Also returns one-time recovery codes
   * (plaintext shown once; only digests stored).
   */
  async mfaVerify(
    userId: string,
    code: string,
    metadata: SessionMetadata = {},
  ): Promise<AuthTokens & { recoveryCodes: string[] }> {
    const user = await this.activeUserOrThrow(userId);
    if (!user.mfaPendingSecret) {
      throw new BadRequestException('No MFA enrollment in progress — call /auth/mfa/enroll first');
    }
    const secret = await this.decryptMfaSecret(user.mfaPendingSecret, user.tenantId);
    const result = await verifyTotp({ secret, token: code, epochTolerance: 30 });
    if (!result.valid) {
      throw new UnauthorizedException({ code: MfaErrorCode.MFA_INVALID, message: 'Invalid MFA code' });
    }
    const sealed = await this.cipher.encryptString(secret, user.tenantId);
    const recoveryCodes = Array.from({ length: 8 }, () =>
      randomBytes(6).toString('hex'),
    );
    const mfaRecoveryHashes = recoveryCodes.map((c) => digestToken(c.toLowerCase()));
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        mfaEnabled: true,
        mfaSecret: sealed ?? secret,
        mfaPendingSecret: null,
        mfaRecoveryHashes,
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.mfa_enabled',
      entityType: 'User',
      entityId: user.id,
      after: { recoveryCodeCount: recoveryCodes.length },
      critical: true,
    });
    // Revoke prior refresh family so the restricted pre-enrollment session dies.
    await TenantContext.run({ tenantId: user.tenantId }, () =>
      this.prisma.refreshSession.updateMany({
        where: { userId: user.id, tenantId: user.tenantId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
    const tokens = await TenantContext.run({ tenantId: user.tenantId }, () =>
      this.issueTokens(user.id, metadata),
    );
    return { ...tokens, recoveryCodes };
  }

  private async resolveRegistrationTenant(tenantSlug?: string): Promise<{ id: string }> {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        status: ACTIVE_TENANT_STATUS,
        selfRegistrationEnabled: true,
        ...(tenantSlug ? { slug: tenantSlug } : {}),
      },
      select: { id: true },
      take: 2,
    });
    if (tenants.length !== 1) {
      throw new BadRequestException(
        tenantSlug ? 'Registration is unavailable for this tenant' : 'tenantSlug is required for registration',
      );
    }
    return tenants[0]!;
  }

  private async activeUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { tenant: true } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE' || user.tenant.status !== ACTIVE_TENANT_STATUS) {
      throw new UnauthorizedException('Account is not active');
    }
    return user;
  }

  private async decryptMfaSecret(value: string | null, tenantId: string): Promise<string> {
    if (!value) throw new UnauthorizedException('MFA configuration is invalid');
    const secret = await this.cipher.decryptString(value, tenantId);
    if (!secret) throw new UnauthorizedException('MFA configuration is invalid');
    return secret;
  }

  private isActiveTokenUser(user: TokenUser): boolean {
    return (
      !user.deletedAt &&
      user.status === 'ACTIVE' &&
      user.tenant.status === ACTIVE_TENANT_STATUS
    );
  }

  private async issueTokens(userId: string, metadata: SessionMetadata): Promise<AuthTokens> {
    const user = (await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        tenant: true,
        roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    })) as unknown as TokenUser;
    if (!this.isActiveTokenUser(user)) throw new UnauthorizedException('Account is not active');

    const sessionId = randomUUID();
    const familyId = sessionId;
    const tokens = await this.signTokens(user, sessionId, familyId);
    await this.prisma.refreshSession.create({ data: this.sessionData(tokens, user, sessionId, familyId, metadata) });
    return tokens.public;
  }

  private async signTokens(user: TokenUser, sessionId: string, familyId: string) {
    const roles = user.roleAssignments.map((assignment) => assignment.role.name);
    const permissions = new Set<string>();
    for (const assignment of user.roleAssignments) {
      const dbPermissions = assignment.role.permissions.map((grant) => grant.permission.key);
      const effective =
        dbPermissions.length > 0
          ? dbPermissions
          : ROLE_PERMISSIONS[assignment.role.name as keyof typeof ROLE_PERMISSIONS] ?? [];
      effective.forEach((permission) => permissions.add(permission));
    }
    const firstAssignment = user.roleAssignments[0];
    const accessTtl = positiveTtl('JWT_ACCESS_TTL', DEFAULT_ACCESS_TTL_SECONDS);
    const refreshTtl = positiveTtl('JWT_REFRESH_TTL_SECONDS', DEFAULT_REFRESH_TTL_SECONDS);
    const mfaEnrollmentRequired = requiresMfaEnrollment(roles, Boolean(user.mfaEnabled));

    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        tenantId: user.tenantId,
        roles,
        permissions: [...permissions],
        clinicId: firstAssignment?.clinicId ?? undefined,
        jurisdiction: firstAssignment?.jurisdiction ?? undefined,
        typ: 'access',
        sid: sessionId,
        ver: user.authVersion,
        // false means full access; true restricts the principal to auth/MFA routes.
        mfaEnrollmentRequired,
      },
      { secret: jwtAccessSecret(), expiresIn: accessTtl },
    );
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tenantId: user.tenantId, typ: 'refresh', sid: sessionId, fid: familyId },
      { secret: jwtRefreshSecret(), expiresIn: refreshTtl },
    );

    return {
      refreshToken,
      refreshTtl,
      public: {
        accessToken,
        refreshToken,
        expiresIn: accessTtl,
        refreshExpiresIn: refreshTtl,
        principal: {
          userId: user.id,
          tenantId: user.tenantId,
          roles,
          permissions: [...permissions],
          mfaEnrollmentRequired,
        },
      } satisfies AuthTokens,
    };
  }

  private sessionData(
    tokens: Awaited<ReturnType<AuthService['signTokens']>>,
    user: TokenUser,
    sessionId: string,
    familyId: string,
    metadata: SessionMetadata,
  ) {
    return {
      id: sessionId,
      tenantId: user.tenantId,
      userId: user.id,
      familyId,
      tokenHash: digestToken(tokens.refreshToken),
      expiresAt: new Date(Date.now() + tokens.refreshTtl * 1000),
      userAgent: metadata.userAgent?.slice(0, 512),
      ipHash: metadata.ip ? createHmac('sha256', jwtRefreshSecret()).update(metadata.ip).digest('hex') : undefined,
    };
  }

  private async verifyRefreshToken(token: string, ignoreExpiration = false): Promise<RefreshClaims> {
    let payload: Record<string, unknown>;
    try {
      payload = await this.jwt.verifyAsync(token, { secret: jwtRefreshSecret(), ignoreExpiration });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    if (
      payload.typ !== 'refresh' ||
      typeof payload.sub !== 'string' ||
      typeof payload.tenantId !== 'string' ||
      typeof payload.sid !== 'string' ||
      typeof payload.fid !== 'string'
    ) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
    return payload as unknown as RefreshClaims;
  }
}
