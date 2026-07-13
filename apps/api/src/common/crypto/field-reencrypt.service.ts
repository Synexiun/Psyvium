import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { TenantContext } from '../prisma/tenant-context';
import {
  FieldCipherService,
  fieldEnvelopeKid,
  stringArrayFieldEnvelopeKid,
  stringFieldEnvelopeKid,
} from './field-cipher';

const SWEEP_MS = 5 * 60_000;
const SYSTEM_ACTOR = 'system.field-reencrypt';
const BATCH = 50;

export type ReencryptTable =
  | 'sessionNote'
  | 'safetyPlan'
  | 'message'
  | 'smsMessage'
  | 'intake'
  | 'userMfa';

export interface ReencryptRunResult {
  active: boolean;
  activeKeyId: string | null;
  sealPlaintext: boolean;
  scanned: number;
  rewritten: number;
  skipped: number;
  errors: number;
  byTable: Record<string, { scanned: number; rewritten: number; errors: number }>;
}

/**
 * Bulk re-encrypt PHI fields onto the active DEK kid after rotation.
 *
 * Activate background sweep: VPSY_FIELD_REENCRYPT=true
 * Optional seal of remaining plaintext: VPSY_FIELD_REENCRYPT_SEAL_PLAINTEXT=true
 *
 * Manual: AdminService / POST /admin/security/field-reencrypt
 *
 * Tables covered: SessionNote.content, SafetyPlan PHI columns, Message.body,
 * SmsMessage.body, Intake free-text, User.mfaSecret.
 * Decrypt uses previous keys still configured on FieldCipherService.
 */
@Injectable()
export class FieldReencryptService {
  private readonly logger = new Logger(FieldReencryptService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: FieldCipherService,
    private readonly audit: AuditService,
  ) {}

  get backgroundEnabled(): boolean {
    return process.env.VPSY_FIELD_REENCRYPT === 'true';
  }

  get sealPlaintextDefault(): boolean {
    return process.env.VPSY_FIELD_REENCRYPT_SEAL_PLAINTEXT === 'true';
  }

  async status(): Promise<{
    cipherActive: boolean;
    activeKeyId: string | null;
    backgroundEnabled: boolean;
    sealPlaintextDefault: boolean;
    tables: ReencryptTable[];
  }> {
    await this.cipher.whenReady();
    return {
      cipherActive: this.cipher.isActive,
      activeKeyId: this.cipher.activeKeyId,
      backgroundEnabled: this.backgroundEnabled,
      sealPlaintextDefault: this.sealPlaintextDefault,
      tables: ['sessionNote', 'safetyPlan', 'message', 'smsMessage', 'intake', 'userMfa'],
    };
  }

  @Interval(SWEEP_MS)
  async backgroundSweep(): Promise<void> {
    if (!this.backgroundEnabled || this.running) return;
    if (!this.cipher.isActive) return;
    try {
      await this.runForAllTenants({ sealPlaintext: this.sealPlaintextDefault });
    } catch (err) {
      this.logger.error(`Field re-encrypt sweep failed: ${(err as Error).message}`);
    }
  }

  async runForAllTenants(opts: { sealPlaintext?: boolean; take?: number } = {}): Promise<ReencryptRunResult> {
    if (this.running) {
      throw new ServiceUnavailableException('Field re-encrypt already running');
    }
    this.running = true;
    try {
      const tenants = await this.prisma.tenant.findMany({ select: { id: true } });
      const totals = emptyResult(this.cipher);
      totals.sealPlaintext = opts.sealPlaintext ?? this.sealPlaintextDefault;
      for (const t of tenants) {
        const partial = await TenantContext.run({ tenantId: t.id }, () =>
          this.runForTenant(t.id, opts),
        );
        mergeResults(totals, partial);
      }
      return totals;
    } finally {
      this.running = false;
    }
  }

  async runForTenant(
    tenantId: string,
    opts: { sealPlaintext?: boolean; take?: number } = {},
  ): Promise<ReencryptRunResult> {
    await this.cipher.whenReady();
    if (!this.cipher.isActive) {
      return emptyResult(this.cipher);
    }
    const sealPlaintext = opts.sealPlaintext ?? this.sealPlaintextDefault;
    const take = Math.min(Math.max(opts.take ?? BATCH, 1), 200);
    const result = emptyResult(this.cipher);
    result.sealPlaintext = sealPlaintext;

    await this.sweepSessionNotes(tenantId, sealPlaintext, take, result);
    await this.sweepSafetyPlans(tenantId, sealPlaintext, take, result);
    await this.sweepMessages(tenantId, sealPlaintext, take, result);
    await this.sweepSms(tenantId, sealPlaintext, take, result);
    await this.sweepIntake(tenantId, sealPlaintext, take, result);
    await this.sweepUserMfa(tenantId, sealPlaintext, take, result);

    if (result.rewritten > 0 || result.errors > 0) {
      await this.audit.record({
        tenantId,
        actorId: SYSTEM_ACTOR,
        action: 'field.reencrypt_batch',
        entityType: 'FieldCipher',
        entityId: this.cipher.activeKeyId ?? 'active',
        after: {
          activeKeyId: this.cipher.activeKeyId,
          sealPlaintext,
          scanned: result.scanned,
          rewritten: result.rewritten,
          errors: result.errors,
          byTable: result.byTable,
        },
        critical: result.errors > 0,
      });
    }
    return result;
  }

  private async sweepSessionNotes(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    const rows = await this.prisma.sessionNote.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, content: true },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.sessionNote!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const kid = fieldEnvelopeKid(row.content);
      if (!(await this.cipher.needsReencrypt(kid, { sealPlaintext }))) {
        result.skipped += 1;
        continue;
      }
      try {
        const plain = await this.cipher.decryptJson(row.content, tenantId);
        const next = await this.cipher.encryptJson(plain, tenantId);
        await this.prisma.sessionNote.update({
          where: { id: row.id },
          data: { content: next as object },
        });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`sessionNote ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }

  private async sweepSafetyPlans(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    const rows = await this.prisma.safetyPlan.findMany({
      where: { tenantId, deletedAt: null },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.safetyPlan!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const kids = [
        stringArrayFieldEnvelopeKid(row.warningSigns),
        stringArrayFieldEnvelopeKid(row.copingStrategies),
        fieldEnvelopeKid(row.supportContacts),
        fieldEnvelopeKid(row.professionalContacts),
        stringFieldEnvelopeKid(row.environmentSafety),
        fieldEnvelopeKid(row.distractionContacts),
        fieldEnvelopeKid(row.helpContacts),
        fieldEnvelopeKid(row.crisisLineInfo),
        fieldEnvelopeKid(row.meansRestriction),
      ];
      let needs = false;
      for (const k of kids) {
        if (await this.cipher.needsReencrypt(k, { sealPlaintext })) {
          needs = true;
          break;
        }
      }
      if (!needs) {
        result.skipped += 1;
        continue;
      }
      try {
        const [
          warningSigns,
          copingStrategies,
          supportContacts,
          professionalContacts,
          environmentSafety,
          distractionContacts,
          helpContacts,
          crisisLineInfo,
          meansRestriction,
        ] = await Promise.all([
          this.cipher.decryptStringArray(row.warningSigns, tenantId),
          this.cipher.decryptStringArray(row.copingStrategies, tenantId),
          this.cipher.decryptJson(row.supportContacts, tenantId),
          this.cipher.decryptJson(row.professionalContacts, tenantId),
          this.cipher.decryptString(row.environmentSafety, tenantId),
          this.cipher.decryptJson(row.distractionContacts, tenantId),
          this.cipher.decryptJson(row.helpContacts, tenantId),
          this.cipher.decryptJson(row.crisisLineInfo, tenantId),
          this.cipher.decryptJson(row.meansRestriction, tenantId),
        ]);
        await this.prisma.safetyPlan.update({
          where: { id: row.id },
          data: {
            warningSigns: await this.cipher.encryptStringArray(warningSigns, tenantId),
            copingStrategies: await this.cipher.encryptStringArray(copingStrategies, tenantId),
            supportContacts: (await this.cipher.encryptJson(supportContacts, tenantId)) as object,
            professionalContacts: (await this.cipher.encryptJson(
              professionalContacts,
              tenantId,
            )) as object,
            environmentSafety: await this.cipher.encryptString(environmentSafety, tenantId),
            distractionContacts:
              distractionContacts == null
                ? undefined
                : ((await this.cipher.encryptJson(distractionContacts, tenantId)) as object),
            helpContacts:
              helpContacts == null
                ? undefined
                : ((await this.cipher.encryptJson(helpContacts, tenantId)) as object),
            crisisLineInfo:
              crisisLineInfo == null
                ? undefined
                : ((await this.cipher.encryptJson(crisisLineInfo, tenantId)) as object),
            meansRestriction:
              meansRestriction == null
                ? undefined
                : ((await this.cipher.encryptJson(meansRestriction, tenantId)) as object),
          },
        });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`safetyPlan ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }

  private async sweepMessages(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    // Message has no tenantId — join via thread
    const rows = await this.prisma.message.findMany({
      where: { deletedAt: null, thread: { tenantId } },
      select: { id: true, body: true },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.message!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const kid = stringFieldEnvelopeKid(row.body);
      if (!(await this.cipher.needsReencrypt(kid, { sealPlaintext }))) {
        result.skipped += 1;
        continue;
      }
      try {
        const plain = (await this.cipher.decryptString(row.body, tenantId)) ?? row.body;
        const next = await this.cipher.encryptString(plain, tenantId);
        await this.prisma.message.update({ where: { id: row.id }, data: { body: next ?? plain } });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`message ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }

  private async sweepSms(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    const rows = await this.prisma.smsMessage.findMany({
      where: { tenantId, deletedAt: null },
      select: { id: true, body: true },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.smsMessage!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const kid = stringFieldEnvelopeKid(row.body);
      if (!(await this.cipher.needsReencrypt(kid, { sealPlaintext }))) {
        result.skipped += 1;
        continue;
      }
      try {
        const plain = (await this.cipher.decryptString(row.body, tenantId)) ?? row.body;
        const next = await this.cipher.encryptString(plain, tenantId);
        await this.prisma.smsMessage.update({
          where: { id: row.id },
          data: { body: next ?? plain },
        });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`smsMessage ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }

  private async sweepIntake(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    const rows = await this.prisma.intake.findMany({
      where: { tenantId, deletedAt: null },
      select: {
        id: true,
        presentingProblem: true,
        symptomHistory: true,
        medicationHistory: true,
      },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.intake!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const needs =
        (await this.cipher.needsReencrypt(stringFieldEnvelopeKid(row.presentingProblem), {
          sealPlaintext,
        })) ||
        (await this.cipher.needsReencrypt(stringFieldEnvelopeKid(row.symptomHistory), {
          sealPlaintext,
        })) ||
        (await this.cipher.needsReencrypt(stringFieldEnvelopeKid(row.medicationHistory), {
          sealPlaintext,
        }));
      if (!needs) {
        result.skipped += 1;
        continue;
      }
      try {
        const presentingProblem =
          (await this.cipher.encryptString(
            (await this.cipher.decryptString(row.presentingProblem, tenantId)) ?? row.presentingProblem,
            tenantId,
          )) ?? row.presentingProblem;
        const symptomHistory = row.symptomHistory
          ? await this.cipher.encryptString(
              (await this.cipher.decryptString(row.symptomHistory, tenantId)) ?? row.symptomHistory,
              tenantId,
            )
          : row.symptomHistory;
        const medicationHistory = row.medicationHistory
          ? await this.cipher.encryptString(
              (await this.cipher.decryptString(row.medicationHistory, tenantId)) ??
                row.medicationHistory,
              tenantId,
            )
          : row.medicationHistory;
        await this.prisma.intake.update({
          where: { id: row.id },
          data: {
            presentingProblem,
            symptomHistory: symptomHistory ?? undefined,
            medicationHistory: medicationHistory ?? undefined,
          },
        });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`intake ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }

  private async sweepUserMfa(
    tenantId: string,
    sealPlaintext: boolean,
    take: number,
    result: ReencryptRunResult,
  ): Promise<void> {
    const rows = await this.prisma.user.findMany({
      where: { tenantId, deletedAt: null, mfaSecret: { not: null } },
      select: { id: true, mfaSecret: true },
      take,
      orderBy: { createdAt: 'asc' },
    });
    const t = result.byTable.userMfa!;
    for (const row of rows) {
      t.scanned += 1;
      result.scanned += 1;
      const kid = stringFieldEnvelopeKid(row.mfaSecret);
      if (!(await this.cipher.needsReencrypt(kid, { sealPlaintext }))) {
        result.skipped += 1;
        continue;
      }
      try {
        const plain =
          (await this.cipher.decryptString(row.mfaSecret, tenantId)) ?? row.mfaSecret!;
        const next = await this.cipher.encryptString(plain, tenantId);
        await this.prisma.user.update({
          where: { id: row.id },
          data: { mfaSecret: next ?? plain },
        });
        t.rewritten += 1;
        result.rewritten += 1;
      } catch (err) {
        t.errors += 1;
        result.errors += 1;
        this.logger.warn(`user mfa ${row.id} reencrypt failed: ${(err as Error).message}`);
      }
    }
  }
}

function emptyResult(cipher: FieldCipherService): ReencryptRunResult {
  const tables = ['sessionNote', 'safetyPlan', 'message', 'smsMessage', 'intake', 'userMfa'];
  const byTable: ReencryptRunResult['byTable'] = {};
  for (const name of tables) {
    byTable[name] = { scanned: 0, rewritten: 0, errors: 0 };
  }
  return {
    active: cipher.isActive,
    activeKeyId: cipher.activeKeyId,
    sealPlaintext: false,
    scanned: 0,
    rewritten: 0,
    skipped: 0,
    errors: 0,
    byTable,
  };
}

function mergeResults(into: ReencryptRunResult, partial: ReencryptRunResult): void {
  into.scanned += partial.scanned;
  into.rewritten += partial.rewritten;
  into.skipped += partial.skipped;
  into.errors += partial.errors;
  for (const [k, v] of Object.entries(partial.byTable)) {
    if (!into.byTable[k]) into.byTable[k] = { scanned: 0, rewritten: 0, errors: 0 };
    into.byTable[k]!.scanned += v.scanned;
    into.byTable[k]!.rewritten += v.rewritten;
    into.byTable[k]!.errors += v.errors;
  }
}
