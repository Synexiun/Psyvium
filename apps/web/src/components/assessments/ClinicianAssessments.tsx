'use client';

/**
 * Clinician assessments workspace (doc 07 §9): assign panel + client
 * assignment browser, with the governance note in the context rail. The
 * catalog is loaded once here and shared — the assign panel renders it, the
 * browser uses it to resolve each instrument's clinician scoring-key guide.
 */
import { useCallback } from 'react';
import type { InstrumentGuide } from '@vpsy/contracts';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { ContextPanel } from '@/components/ContextPanel';
import { AssignPanel } from './AssignPanel';
import { ClientAssignmentBrowser } from './ClientAssignmentBrowser';

export function ClinicianAssessments() {
  const { t } = useI18n();
  const { data: catalog, loading, error, reload } = useResource(() => api.assessmentCatalog(), []);

  const guideFor = useCallback(
    (instrumentCode: string): InstrumentGuide | null =>
      catalog?.find((e) => e.code === instrumentCode)?.guide ?? null,
    [catalog],
  );

  return (
    <div>
      <p className="eyebrow">{t('assess.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('assess.clinTitle')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('assess.clinIntro')}</p>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[1fr_1.35fr]">
        <AssignPanel catalog={catalog} loading={loading} error={!!error} onRetry={reload} />
        <ClientAssignmentBrowser guideFor={guideFor} />
      </div>

      {/* Principle in the product: score suppression + human-decision AI. */}
      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('assess.governanceEyebrow')}</p>
          <h2 className="mt-1.5 text-sm font-medium text-mist">{t('common.aiMotto')}</h2>
          <p className="mt-2 text-xs leading-relaxed text-mist/60">{t('assess.governanceBody')}</p>
        </section>
      </ContextPanel>
    </div>
  );
}
