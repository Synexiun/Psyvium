import { ForbiddenException } from '@nestjs/common';
import { AssignmentStatus, Role, type AuthPrincipal } from '@vpsy/contracts';

interface AssessmentTargetClient {
  id: string;
  userId: string;
}

/**
 * Structural Prisma surface — kept loose so unit tests can mock only what
 * they need, and so both PsychometricsService and ClinicalAccessService
 * compatible shapes satisfy the helper.
 */
interface AssessmentTargetPrisma {
  psychologist: {
    findFirst(args: any): Promise<{ id: string } | null>;
  };
  assignment: {
    findFirst(args: any): Promise<{ id: string } | null>;
  };
  breakGlassGrant?: {
    findFirst(args: any): Promise<{ id: string } | null>;
  };
}

/**
 * ABAC for assessment administration AND clinician read/interpret of
 * responses. Clients: self only. Psychologists: active assignment OR live
 * break-glass grant. Managers: tenant operational access. Supervisors:
 * supervised assignment chain. Fail closed otherwise.
 */
export async function assertAuthorizedAssessmentTarget(
  prisma: AssessmentTargetPrisma,
  principal: AuthPrincipal,
  client: AssessmentTargetClient,
): Promise<void> {
  if (principal.roles.includes(Role.CLIENT) && client.userId === principal.userId) return;
  if (principal.roles.includes(Role.MANAGER)) return;

  const now = new Date();

  if (principal.roles.includes(Role.PSYCHOLOGIST)) {
    const psychologist = await prisma.psychologist.findFirst({
      where: {
        tenantId: principal.tenantId,
        userId: principal.userId,
        deletedAt: null,
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true },
    });
    if (psychologist) {
      const assignment = await prisma.assignment.findFirst({
        where: {
          tenantId: principal.tenantId,
          clientId: client.id,
          psychologistId: psychologist.id,
          status: { in: [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
          deletedAt: null,
        },
        select: { id: true },
      });
      if (assignment) return;
    }

    if (prisma.breakGlassGrant) {
      const grant = await prisma.breakGlassGrant.findFirst({
        where: {
          tenantId: principal.tenantId,
          clientId: client.id,
          invokedBy: principal.userId,
          expiresAt: { gt: now },
        },
        select: { id: true },
      });
      if (grant) return;
    }
  }

  if (principal.roles.includes(Role.SUPERVISOR)) {
    const supervised = await prisma.assignment.findFirst({
      where: {
        tenantId: principal.tenantId,
        clientId: client.id,
        deletedAt: null,
        status: { in: [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
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
    if (supervised) return;
  }

  throw new ForbiddenException('Not authorized to administer an assessment for this client');
}
