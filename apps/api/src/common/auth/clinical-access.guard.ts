import { CanActivate, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthPrincipal } from '@vpsy/contracts';
import { PrismaService } from '../prisma/prisma.service';
import { CLINICAL_ACCESS_KEY, type ClinicalAccessRule, type ClinicalResourceKind } from './clinical-access.decorator';
import { ClinicalAccessService } from './clinical-access.service';

@Injectable()
export class ClinicalAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly access: ClinicalAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<ClinicalAccessRule>(CLINICAL_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const req = context.switchToHttp().getRequest();
    const principal: AuthPrincipal | undefined = req.principal;
    if (!principal) throw new ForbiddenException('No principal');

    const rawId = req[rule.source]?.[rule.key];
    if (typeof rawId !== 'string' || rawId.length === 0) {
      throw new ForbiddenException('Clinical resource identifier is required');
    }

    const clientId = await this.resolveClientId(principal.tenantId, rule.resource, rawId);
    await this.access.assertCanAccessClient(principal, clientId);
    return true;
  }

  private async resolveClientId(tenantId: string, kind: ClinicalResourceKind, id: string): Promise<string> {
    if (kind === 'client') return id;

    let clientId: string | undefined;
    switch (kind) {
      case 'session':
        clientId = (
          await this.prisma.session.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { appointment: { select: { clientId: true } } },
          })
        )?.appointment.clientId;
        break;
      case 'note':
        clientId = (
          await this.prisma.sessionNote.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { session: { select: { appointment: { select: { clientId: true } } } } },
          })
        )?.session.appointment.clientId;
        break;
      case 'goal':
        clientId = (
          await this.prisma.goal.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { plan: { select: { clientId: true } } },
          })
        )?.plan.clientId;
        break;
      case 'hypothesis':
        clientId = (
          await this.prisma.diagnosisHypothesis.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { clientId: true },
          })
        )?.clientId;
        break;
      case 'formulation':
        clientId = (
          await this.prisma.formulation.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { clientId: true },
          })
        )?.clientId;
        break;
      case 'intervention':
        clientId = (
          await this.prisma.intervention.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { plan: { select: { clientId: true } } },
          })
        )?.plan?.clientId;
        break;
      case 'homework':
        clientId = (
          await this.prisma.homework.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { intervention: { select: { plan: { select: { clientId: true } } } } },
          })
        )?.intervention.plan?.clientId;
        break;
      case 'riskFlag':
        clientId = (
          await this.prisma.riskFlag.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { clientId: true },
          })
        )?.clientId;
        break;
      case 'escalation':
        clientId = (
          await this.prisma.escalation.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { riskFlag: { select: { clientId: true } } },
          })
        )?.riskFlag.clientId;
        break;
      case 'document': {
        const document = await this.prisma.document.findFirst({
          where: { id, tenantId, deletedAt: null },
          select: { ownerType: true, ownerId: true },
        });
        if (document?.ownerType === 'client') clientId = document.ownerId;
        break;
      }
      case 'wearableDevice':
        clientId = (
          await this.prisma.wearableDevice.findFirst({
            where: { id, tenantId, deletedAt: null },
            select: { clientId: true },
          })
        )?.clientId;
        break;
    }

    if (!clientId) throw new NotFoundException('Clinical resource not found');
    return clientId;
  }
}
