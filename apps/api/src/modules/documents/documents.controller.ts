import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import {
  createDocumentSchema,
  Permission,
  presignDocumentUploadSchema,
  type AuthPrincipal,
  type CreateDocumentInput,
  type PresignDocumentUploadInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalAccessGuard } from '../../common/auth/clinical-access.guard';
import { RequireClinicalAccess } from '../../common/auth/clinical-access.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { DocumentsService } from './documents.service';
import { DocumentVirusScanService } from './document-virus-scan.service';

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
  constructor(
    private readonly documents: DocumentsService,
    private readonly virusScan: DocumentVirusScanService,
  ) {}

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

  /** Trigger a single-document malware scan (ops / staging). */
  @Post(':id/virus-scan')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'document', source: 'params', key: 'id' })
  @RequirePermissions(Permission.CLIENT_WRITE)
  runVirusScan(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.virusScan.scanDocument(user.tenantId, id);
  }

  /** Presign upload (local/S3 backend). Then PUT bytes and POST metadata. */
  @Post('presign-upload')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'client', source: 'body', key: 'ownerId' })
  @RequirePermissions(Permission.CLIENT_WRITE)
  presignUpload(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(presignDocumentUploadSchema)) body: PresignDocumentUploadInput,
  ) {
    return this.documents.presignUpload(user, body);
  }

  @Post(':id/presign-download')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'document', source: 'params', key: 'id' })
  @RequirePermissions(Permission.CLIENT_READ)
  presignDownload(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.documents.presignDownload(user, id);
  }

  /**
   * Local blob PUT target (signed query). No JWT — signature is the credential.
   * Only active when VPSY_DOCUMENT_BLOB_BACKEND=local.
   */
  @Put('blob/upload')
  async blobUpload(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Req() req: Request,
  ) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return this.documents.localUpload(key, exp, sig, Buffer.concat(chunks));
  }

  @Get('blob/download')
  async blobDownload(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res() res: Response,
  ) {
    const body = await this.documents.localDownload(key, exp, sig);
    res.status(200).setHeader('Content-Type', 'application/octet-stream').send(body);
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
