import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createDocumentSchema,
  Permission,
  type AuthPrincipal,
  type CreateDocumentInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalAccessGuard } from '../../common/auth/clinical-access.guard';
import { RequireClinicalAccess } from '../../common/auth/clinical-access.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DocumentsService } from './documents.service';

/**
 * Documents (context 23 — Generic kind, not a clinical-write DoD item like
 * session notes/treatment plans/diagnoses), so writes are NOT gated by
 * ClinicalWriteGuard. There is no dedicated `DOCUMENT_*` permission
 * (rbac.ts is out of scope for this change) — `create` reuses
 * `Permission.CLIENT_WRITE` (granted to PSYCHOLOGIST only), and reads reuse
 * `Permission.CLIENT_READ` (CLIENT/PSYCHOLOGIST/MANAGER).
 */
@ApiTags('documents')
@ApiBearerAuth()
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  /**
   * Capability probe for the UI: reports whether blob storage is live or
   * metadata-only / disabled. Never pretends uploads work when they do not.
   * Includes virusScanStatus workflow notes for ops/UI.
   */
  @Get('status')
  @RequirePermissions(Permission.CLIENT_READ)
  status() {
    return this.documents.capabilityStatus();
  }

  /**
   * Documents still at virusScanStatus=pending — manager/admin triage surface
   * for the (future) malware-scan worker backlog.
   */
  @Get('virus-scan/pending')
  @RequirePermissions(Permission.CLIENT_READ)
  listPendingVirusScan(@CurrentUser() user: AuthPrincipal) {
    return this.documents.listPendingVirusScan(user);
  }

  /** Registers document METADATA only — see honesty note in documents.service.ts. */
  @Post()
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'ownerId' })
  @RequirePermissions(Permission.CLIENT_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: CreateDocumentInput,
  ) {
    return this.documents.create(user, body);
  }

  @Get('client/:clientId')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'params', key: 'clientId' })
  @RequirePermissions(Permission.CLIENT_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.documents.listForClient(user, clientId);
  }

  @Get(':id')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'document', source: 'params', key: 'id' })
  @RequirePermissions(Permission.CLIENT_READ)
  getById(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.documents.getById(user, id);
  }
}
