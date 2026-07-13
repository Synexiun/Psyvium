import { ForbiddenException } from '@nestjs/common';
import { AssignmentStatus, Role, type AuthPrincipal } from '@vpsy/contracts';

interface AssessmentTargetClient {
  id: string;
  userId: string;
}

interface AssessmentTargetPrisma {
  psychologist: {
    findFirst(args: any): Promise<{ id: string } | null>;
  };
  assignment: {
    findFirst(args: any): Promise<{ id: string } | null>;
  };
}

/**
 * ABAC for static assessment administration. Clients can submit only their
 * own responses; psychologists can submit only for a currently assigned
 * client. Any role not represented by those relationships fails closed.
 */
export async function assertAuthorizedAssessmentTarget(
  prisma: AssessmentTargetPrisma,
  principal: AuthPrincipal,
  client: AssessmentTargetClient,
): Promise<void> {
  if (principal.roles.includes(Role.CLIENT) && client.userId === principal.userId) return;

  if (principal.roles.includes(Role.PSYCHOLOGIST)) {
    const psychologist = await prisma.psychologist.findFirst({
      where: {
        tenantId: principal.tenantId,
        userId: principal.userId,
        acceptingClients: true,
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
  }

  throw new ForbiddenException('Not authorized to administer an assessment for this client');
}
