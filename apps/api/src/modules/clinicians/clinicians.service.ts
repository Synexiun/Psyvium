import { Injectable, NotFoundException } from '@nestjs/common';
import { AssignmentStatus, type AuthPrincipal, type CaseloadEntry } from '@vpsy/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';

/**
 * Clinician-facing read-models. Currently a single view: the authenticated
 * psychologist's active caseload (resolved via Psychologist.userId).
 */
@Injectable()
export class CliniciansService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCaseload(principal: AuthPrincipal): Promise<CaseloadEntry[]> {
    const psychologist = await this.prisma.psychologist.findFirst({
      where: { userId: principal.userId, tenantId: principal.tenantId },
    });
    if (!psychologist) throw new NotFoundException('Psychologist profile not found for this user');

    const assignments = await this.prisma.assignment.findMany({
      where: {
        psychologistId: psychologist.id,
        tenantId: principal.tenantId,
        status: { in: [AssignmentStatus.APPROVED, AssignmentStatus.ACTIVE] },
      },
      include: { client: { include: { user: true } } },
    });

    const clientIds = assignments.map((a) => a.clientId);
    const upcoming = clientIds.length
      ? await this.prisma.appointment.findMany({
          where: {
            clientId: { in: clientIds },
            tenantId: principal.tenantId,
            startsAt: { gte: new Date() },
            status: { in: ['BOOKED', 'CONFIRMED'] },
          },
          orderBy: { startsAt: 'asc' },
        })
      : [];

    const nextByClient = new Map<string, Date>();
    for (const appt of upcoming) {
      if (!nextByClient.has(appt.clientId)) nextByClient.set(appt.clientId, appt.startsAt);
    }

    // A client may (rarely) have more than one APPROVED/ACTIVE assignment row
    // for the same psychologist (e.g. a historical transfer never closed) —
    // the caseload is a per-client view, so dedupe defensively.
    const byClient = new Map<string, CaseloadEntry>();
    for (const a of assignments) {
      if (byClient.has(a.clientId)) continue;
      byClient.set(a.clientId, {
        clientId: a.clientId,
        displayName: a.client.user.fullName,
        riskLevel: a.client.riskLevel as CaseloadEntry['riskLevel'],
        nextAppointmentAt: nextByClient.get(a.clientId)?.toISOString() ?? null,
      });
    }
    return Array.from(byClient.values());
  }
}
