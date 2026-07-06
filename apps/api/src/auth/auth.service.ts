import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AuthTokens, LoginInput, RegisterInput } from '@vpsy/contracts';
import { ROLE_PERMISSIONS } from '@vpsy/contracts';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../common/audit/audit.service';

const DEMO_TENANT = 'tenant_demo';

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
    const role = await this.prisma.role.findUnique({ where: { name: input.role as any } });
    if (role) {
      await this.prisma.roleAssignment.create({ data: { userId: user.id, roleId: role.id } });
    }
    await this.audit.record({
      tenantId: user.tenantId,
      actorId: user.id,
      action: 'user.registered',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email, role: input.role },
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
    // Permissions: union of DB-granted + declarative baseline (defense-in-depth if seed is partial)
    const dbPerms = user.roleAssignments.flatMap((ra) => ra.role.permissions.map((rp) => rp.permission.key));
    const declaredPerms = roles.flatMap((r) => ROLE_PERMISSIONS[r as keyof typeof ROLE_PERMISSIONS] ?? []);
    const permissions = Array.from(new Set([...dbPerms, ...declaredPerms]));
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
      secret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me',
      expiresIn: ttl,
    });
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, tenantId: user.tenantId, typ: 'refresh' },
      { secret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret-change-me', expiresIn: '30d' },
    );
    return { accessToken, refreshToken, expiresIn: ttl };
  }
}
