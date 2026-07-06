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

  /** Registers document METADATA only — see honesty note in documents.service.ts. */
  @Post()
  @RequirePermissions(Permission.CLIENT_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createDocumentSchema)) body: CreateDocumentInput,
  ) {
    return this.documents.create(user, body);
  }

  @Get('client/:clientId')
  @RequirePermissions(Permission.CLIENT_READ)
  listForClient(@CurrentUser() user: AuthPrincipal, @Param('clientId') clientId: string) {
    return this.documents.listForClient(user, clientId);
  }

  @Get(':id')
  @RequirePermissions(Permission.CLIENT_READ)
  getById(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.documents.getById(user, id);
  }
}
