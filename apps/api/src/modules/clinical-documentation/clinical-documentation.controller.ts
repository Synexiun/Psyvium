import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  createSessionNoteSchema,
  sessionNoteAiAssistRequestSchema,
  Permission,
  type AuthPrincipal,
  type CreateSessionNoteInput,
  type SessionNoteAiAssistInput,
} from '@vpsy/contracts';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/auth/permissions.guard';
import { ClinicalWriteGuard } from '../../common/auth/clinical-write.guard';
import { ClinicalAccessGuard } from '../../common/auth/clinical-access.guard';
import { RequireClinicalAccess } from '../../common/auth/clinical-access.decorator';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ClinicalDocumentationService } from './clinical-documentation.service';

@ApiTags('clinical-documentation')
@ApiBearerAuth()
@Controller('session-notes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClinicalDocumentationController {
  constructor(private readonly notes: ClinicalDocumentationService) {}

  /**
   * Always appends the next version for the session — never mutates a prior
   * row. Gated by ClinicalWriteGuard: license must be verified/active and
   * jurisdiction-matched (Phase 2 DoD).
   */
  @Post()
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'session', source: 'body', key: 'sessionId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  create(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(createSessionNoteSchema)) body: CreateSessionNoteInput,
  ) {
    return this.notes.create(user, body);
  }

  @Get('session/:sessionId')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'session', source: 'params', key: 'sessionId' })
  @RequirePermissions(Permission.NOTE_READ)
  listBySession(@CurrentUser() user: AuthPrincipal, @Param('sessionId') sessionId: string) {
    return this.notes.listBySession(user, sessionId);
  }

  /** One-way transition; a signed note can never be re-signed or edited in place. */
  @Post(':id/sign')
  @UseGuards(ClinicalWriteGuard, ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'note', source: 'params', key: 'id' })
  @RequirePermissions(Permission.NOTE_WRITE)
  sign(@CurrentUser() user: AuthPrincipal, @Param('id') id: string) {
    return this.notes.sign(user, id);
  }

  /**
   * Session-Note Assistant (doc 05 §3.4). Returns an assistive DRAFT
   * scaffold only — it never creates or signs a note itself; the clinician
   * reviews, edits, and files their own note via `create()`/`sign()` above.
   * Not gated by ClinicalWriteGuard: this is a suggestion, not a clinical
   * record mutation.
   */
  @Post('ai-assist')
  @UseGuards(ClinicalAccessGuard)
  @RequireClinicalAccess({ resource: 'session', source: 'body', key: 'sessionId' })
  @RequirePermissions(Permission.NOTE_WRITE)
  aiAssist(
    @CurrentUser() user: AuthPrincipal,
    @Body(new ZodValidationPipe(sessionNoteAiAssistRequestSchema)) body: SessionNoteAiAssistInput,
  ) {
    return this.notes.aiAssist(user, body);
  }
}
