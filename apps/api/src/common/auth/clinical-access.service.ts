import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, Role, type AuthPrincipal } from '@vpsy/contracts';
import { PrismaService } from '../prisma/prisma.service';

const CARE_ASSIGNMENT_STATUSES = [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE];

/** Central minimum-necessary policy for client clinical data. */
@Injectable()
export class ClinicalAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertCanAccessClient(principal: AuthPrincipal, clientId: string): Promise<void> {
    if (!clientId) throw new ForbiddenException('Client access denied');

    const client = await this.prisma.client.findFirst({
      where: { id: clientId, tenantId: principal.tenantId, deletedAt: null },
      select: { id: true, userId: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    if (principal.roles.includes(Role.CLIENT) && client.userId === principal.userId) return;
    if (principal.roles.includes(Role.MANAGER)) return;

    const now = new Date();
    if (principal.roles.includes(Role.PSYCHOLOGIST)) {
      const [assignment, breakGlass] = await Promise.all([
        this.prisma.assignment.findFirst({
          where: {
            tenantId: principal.tenantId,
            clientId,
            deletedAt: null,
            status: { in: CARE_ASSIGNMENT_STATUSES },
            psychologist: { is: { userId: principal.userId, deletedAt: null } },
          },
          select: { id: true },
        }),
        this.prisma.breakGlassGrant.findFirst({
          where: {
            tenantId: principal.tenantId,
            clientId,
            invokedBy: principal.userId,
            expiresAt: { gt: now },
          },
          select: { id: true },
        }),
      ]);
      if (assignment || breakGlass) return;
    }

    if (principal.roles.includes(Role.SUPERVISOR)) {
      const supervisedAssignment = await this.prisma.assignment.findFirst({
        where: {
          tenantId: principal.tenantId,
          clientId,
          deletedAt: null,
          status: { in: CARE_ASSIGNMENT_STATUSES },
          psychologist: {
            is: {
              deletedAt: null,
              contracts: {
                some: {
                  tenantId: principal.tenantId,
                  supervisorId: principal.userId,
                  status: 'active',
                  deletedAt: null,
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                },
              },
            },
          },
        },
        select: { id: true },
      });
      if (supervisedAssignment) return;
    }

    throw new ForbiddenException('Client access denied');
  }

  /**
   * Returns the finite client scope for list/board queries. `null` means the
   * manager's operational tenant-wide scope; an empty array means no access.
   */
  async listAccessibleClientIds(principal: AuthPrincipal): Promise<string[] | null> {
    if (principal.roles.includes(Role.MANAGER)) return null;

    const ids = new Set<string>();
    const now = new Date();
    if (principal.roles.includes(Role.CLIENT)) {
      const client = await this.prisma.client.findFirst({
        where: { tenantId: principal.tenantId, userId: principal.userId, deletedAt: null },
        select: { id: true },
      });
      if (client) ids.add(client.id);
    }

    if (principal.roles.includes(Role.PSYCHOLOGIST)) {
      const [assignments, grants] = await Promise.all([
        this.prisma.assignment.findMany({
          where: {
            tenantId: principal.tenantId,
            deletedAt: null,
            status: { in: CARE_ASSIGNMENT_STATUSES },
            psychologist: { is: { userId: principal.userId, deletedAt: null } },
          },
          select: { clientId: true },
        }),
        this.prisma.breakGlassGrant.findMany({
          where: { tenantId: principal.tenantId, invokedBy: principal.userId, expiresAt: { gt: now } },
          select: { clientId: true },
        }),
      ]);
      for (const row of [...assignments, ...grants]) ids.add(row.clientId);
    }

    if (principal.roles.includes(Role.SUPERVISOR)) {
      const assignments = await this.prisma.assignment.findMany({
        where: {
          tenantId: principal.tenantId,
          deletedAt: null,
          status: { in: CARE_ASSIGNMENT_STATUSES },
          psychologist: {
            is: {
              deletedAt: null,
              contracts: {
                some: {
                  tenantId: principal.tenantId,
                  supervisorId: principal.userId,
                  status: 'active',
                  deletedAt: null,
                  effectiveFrom: { lte: now },
                  OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                },
              },
            },
          },
        },
        select: { clientId: true },
      });
      for (const row of assignments) ids.add(row.clientId);
    }

    return [...ids];
  }
}
