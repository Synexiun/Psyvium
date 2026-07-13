import { ForbiddenException } from '@nestjs/common';

/**
 * Instrument licensing gate (docs/technical/07-psychometrics-engine.md §2).
 *
 * PUBLIC_DOMAIN instruments ship freely. LICENSED / PROPRIETARY instruments
 * require an active, unexpired `InstrumentLicenseGrant` for the tenant —
 * absent/expired/revoked grants fail closed with 403 LICENSE_REQUIRED so
 * premium content is never administered without a royalty-tracked grant.
 */

export type LicenseQuestionnaire = {
  id: string;
  licensing: string;
  code?: string | null;
};

type LicenseGrantRow = {
  status: string;
  expiresAt: Date | null;
};

export type InstrumentLicensePrisma = {
  instrumentLicenseGrant: {
    findUnique: (args: {
      where: { tenantId_questionnaireId: { tenantId: string; questionnaireId: string } };
    }) => Promise<LicenseGrantRow | null>;
  };
};

const FREE_LICENSING = new Set(['PUBLIC_DOMAIN']);

export async function assertActiveInstrumentLicense(
  prisma: InstrumentLicensePrisma,
  tenantId: string,
  questionnaire: LicenseQuestionnaire,
): Promise<void> {
  if (FREE_LICENSING.has(questionnaire.licensing)) return;

  const grant = await prisma.instrumentLicenseGrant.findUnique({
    where: {
      tenantId_questionnaireId: {
        tenantId,
        questionnaireId: questionnaire.id,
      },
    },
  });

  const now = new Date();
  const active =
    grant !== null &&
    grant.status === 'ACTIVE' &&
    (grant.expiresAt === null || grant.expiresAt > now);

  if (!active) {
    throw new ForbiddenException(
      `LICENSE_REQUIRED: no active InstrumentLicenseGrant for instrument ${questionnaire.code ?? questionnaire.id} (${questionnaire.licensing})`,
    );
  }
}
