import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens, LoginInput, RegisterInput } from '@vpsy/contracts';
import { ROLE_PERMISSIONS, Role } from '@vpsy/contracts';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';
import { jwtAccessSecret, jwtRefreshSecret } from '../common/config/jwt-secrets';

const DEMO_TENANT = 'tenant_demo';

/**
 * The ONLY role a caller may obtain via public self-registration. Elevated roles
 * are provisioned by an authorized admin through a separate authenticated flow —
 * never chosen by the registrant (that would be privilege escalation).
 */
const SELF_REGISTRATION_ROLE: Role = Role.CLIENT;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterInput): Promise<AuthTokens> {
    const hashed = await argon2.hash(input.password);
    const user = await this.prisma.user.create({
      data: {
        tenantId: DEMO_TENANT,
        email: input.email,
        fullName: input.fullName,
        hashedPassword: hashed,
        locale: input.locale,
        timezone: input.timezone,
      },
    });
    // Role is server-assigned, NOT taken from the request — always CLIENT for self-registration.
    const role = await this.prisma.role.findUnique({ where: { name: SELF_REGISTRATION_ROLE } });
    if (role) {
      await this.prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.registered',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: SELF_REGISTRATION_ROLE },
    });
    return this.issueTokens(user.id);
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const user = await this.prisma.user.findFirst({
      where: { email: input.email, deletedAt: null },
    });
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await argon2.verify(user.hashedPassword, input.password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.login',
      entityType: 'User',
      entityId: user.id,
    });
    return this.issueTokens(user.id);
  }

  /** Resolves roles + permissions for a user and mints access/refresh tokens. */
  private async issueTokens(userId: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        roleAssignments: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    const roles = user.roleAssignments.map((ra) => ra.role.name);
    // Permissions are DB-authoritative: the DB grants for a role are used verbatim so a
    // permission revoked in the DB actually takes effect. The declarative ROLE_PERMISSIONS
    // baseline is only a fallback for a role that has NO DB grants at all (partial/unseeded
    // config) — it never augments or overrides explicit DB grants (which would let a revoked
    // permission silently reappear).
    const permSet = new Set<string>();
    for (const ra of user.roleAssignments) {
      const dbPerms = ra.role.permissions.map((rp) => rp.permission.key);
      const effective =
        dbPerms.length > 0 ? dbPerms : ROLE_PERMISSIONS[ra.role.name as keyof typeof ROLE_PERMISSIONS] ?? [];
      effective.forEach((key) => permSet.add(key));
    }
    const permissions = Array.from(permSet);
    const firstAssignment = user.roleAssignments[0];

    const payload = {
      sub: user.id,
      tenantId: user.tenantId,
      roles,
      permissions,
      clinicId: firstAssignment?.clinicId ?? undefined,
      jurisdiction: firstAssignment?.jurisdiction ?? undefined,
    };

    const ttl = Number(process.env.JWT_ACCESS_TTL ?? 900);
    const accessToken = await this.jwt.signAsync(payload, {
      secret: jwtAccessSecret(),
      expiresIn: ttl,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tenantId: user.tenantId, typ: 'refresh' },
      { secret: jwtRefreshSecret(), expiresIn: '30d' },
    );
    return { accessToken, refreshToken, expiresIn: ttl };
  }
}
