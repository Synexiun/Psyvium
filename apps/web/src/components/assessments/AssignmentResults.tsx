'use client';

/**
 * Clinician results view for one COMPLETED assignment (doc 07 §9):
 * item-level answers, the deterministic score/band/interpretation, the
 * instrument's clinician scoring-key guide, and the governed AI briefing.
 *
 * CLINICIAN-ONLY: this component is only ever rendered behind the
 * `assessment:interpret` gate — a CLIENT session never mounts it.
 *
 * The AI briefing is honest about what it is: an AI-generated (or, when the
 * model was consent/kill-switch gated, rule-based) DRAFT sitting behind a
 * human decision. It may not exist yet — that renders as a real "no briefing"
 * state, never a fabricated one.
 */
import { useMemo } from 'react';
import type { InstrumentGuide, QuestionnaireResponseDto } from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { DataTable, type DataColumn } from '@/components/DataTable';
import { SeverityChip } from './SeverityChip';
import { normalizeOptions } from './options';

interface AnswerRow {
  key: string;
  stem: string | null;
  value: number | undefined;
  label: string | null;
}

export function AssignmentResults({
  assignmentId,
  guide,
}: {
  assignmentId: string;
  guide: InstrumentGuide | null;
}) {
  const { t, locale, fmtDate, fmtTime, fmtNumber } = useI18n();

  const {
    data: resp,
    loading,
    error,
    reload,
  } = useResource<QuestionnaireResponseDto>(() => api.assignmentResponse(assignmentId), [assignmentId]);

  // Item stems for the answers table. A stems failure must not sink the
  // response view — the table falls back to item keys, honestly labeled.
  const versionId = resp?.versionId ?? null;
  const { data: itemsData, error: itemsError } = useResource(
    () => (versionId ? api.versionItems(versionId, locale) : Promise.resolve(null)),
    [versionId, locale],
  );

  const rows = useMemo<AnswerRow[]>(() => {
    if (!resp) return [];
    const items = itemsData?.items ? [...itemsData.items].sort((a, b) => a.orderIndex - b.orderIndex) : null;
    if (items && items.length > 0) {
      return items.map((it) => {
        const key = it.linkId ?? it.id;
        const value = resp.answers[key];
        const opts = normalizeOptions(it.responseOptions);
        return {
          key,
          stem: it.stem,
          value,
          label: value === undefined ? null : (opts.find((o) => o.value === value)?.label ?? null),
        };
      });
    }
    return Object.entries(resp.answers).map(([key, value]) => ({ key, stem: null, value, label: null }));
  }, [resp, itemsData]);

  const columns = useMemo<DataColumn<AnswerRow>[]>(
    () => [
      {
        id: 'item',
        header: t('assess.colItem'),
        cell: (r) => (
          <span className="font-mono text-xs" dir="ltr">
            {r.key}
          </span>
        ),
      },
      {
        id: 'question',
        header: t('assess.colQuestion'),
        cell: (r) => r.stem ?? '—',
      },
      {
        id: 'response',
        header: t('assess.colResponse'),
        cell: (r) => r.label ?? '—',
      },
      {
        id: 'value',
        header: t('assess.colValue'),
        numeric: true,
        // `0` is a REAL recorded answer on these instruments — only an absent
        // key renders the em dash.
        cell: (r) => (r.value === undefined ? '—' : String(r.value)),
      },
    ],
    [t],
  );

  if (loading) return <SkeletonCard />;
  if (error) {
    return (
      <ErrorPanel
        message={
          error instanceof ApiError ? t('assess.errStatus', { status: error.status }) : t('assess.responseFailed')
        }
        onRetry={reload}
      />
    );
  }
  if (!resp) return null;

  const score = resp.score;

  return (
    <div className="space-y-4">
      {/* ── Deterministic score — never AI ── */}
      <section className="card p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="eyebrow">{t('assess.resultsEyebrow')}</p>
          <p className="font-mono text-[10px] uppercase tracking-wider text-haze/70" dir="ltr">
            {fmtDate(resp.completedAt)} {fmtTime(resp.completedAt)}
          </p>
        </div>
        {!score ? (
          <p className="mt-3 text-sm text-mist/60">{t('assess.scoreMissing')}</p>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('assess.rawScore')}</p>
                <p className="figure mt-1 text-lg text-mist" dir="ltr">
                  {score.rawScore === null ? '—' : fmtNumber(score.rawScore)}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.theta')}</p>
                <p className="figure mt-1 text-lg text-mist" dir="ltr">
                  {score.thetaEstimate === null ? '—' : fmtNumber(score.thetaEstimate, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.se')}</p>
                <p className="figure mt-1 text-lg text-mist" dir="ltr">
                  {score.standardError === null ? '—' : fmtNumber(score.standardError, { maximumFractionDigits: 2 })}
                </p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.band')}</p>
                <p className="mt-1">
                  {score.severityBand ? <SeverityChip band={score.severityBand} /> : <span className="text-mist/45">—</span>}
                </p>
              </div>
            </div>
            {score.interpretation && (
              <div className="card-inset mt-4 p-3.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{t('cat.interpretation')}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-mist/80">{score.interpretation}</p>
              </div>
            )}
          </>
        )}
      </section>

      {/* ── Item-level answers ── */}
      <section>
        <p className="eyebrow mb-3">{t('assess.answersEyebrow')}</p>
        {itemsError != null && <p className="mb-2 text-[11px] text-mist/50">{t('assess.stemsUnavailable')}</p>}
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.key} caption={t('assess.answersCaption')} empty="—" />
      </section>

      {/* ── Clinician scoring-key guide — reference for the licensed clinician ── */}
      <section className="card p-5">
        <p className="eyebrow">{t('assess.guideEyebrow')}</p>
        {!guide ? (
          <p className="mt-3 text-sm text-mist/55">{t('assess.guideMissing')}</p>
        ) : (
          <div className="mt-3 space-y-3">
            <GuideBlock label={t('assess.guideScoring')} body={guide.scoringKey} />
            <GuideBlock label={t('assess.guideBands')} body={guide.bandGuide} />
            {guide.psychometrics && <GuideBlock label={t('assess.guidePsychometrics')} body={guide.psychometrics} />}
            {guide.cautions && (
              <div className="rounded border border-signal/30 bg-signal/[0.05] p-3.5">
                <p className="font-mono text-[10px] uppercase tracking-wider text-signal/90">
                  {t('assess.guideCautions')}
                </p>
                <p className="mt-1.5 text-sm leading-relaxed text-mist/80">{guide.cautions}</p>
              </div>
            )}
            <p className="text-[11px] leading-relaxed text-mist/45">{guide.reference}</p>
          </div>
        )}
      </section>

      {/* ── Governed AI briefing — a draft behind a human decision ── */}
      {score && <ScoreBriefing scoreId={score.id} />}
    </div>
  );
}

function GuideBlock({ label, body }: { label: string; body: string }) {
  return (
    <div className="card-inset p-3.5">
      <p className="font-mono text-[10px] uppercase tracking-wider text-haze">{label}</p>
      <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed text-mist/80">{body}</p>
    </div>
  );
}

/** Defensive read of the briefing's `output` — shape is `unknown` on the wire. */
function parseBriefingOutput(output: unknown): {
  interpretation: string | null;
  source: 'ai' | 'rule-based' | null;
  withheldReason: string | null;
} {
  if (output === null || typeof output !== 'object') {
    return { interpretation: null, source: null, withheldReason: null };
  }
  const o = output as Record<string, unknown>;
  return {
    interpretation: typeof o.interpretation === 'string' ? o.interpretation : null,
    source: o.source === 'ai' || o.source === 'rule-based' ? o.source : null,
    withheldReason: typeof o.withheldReason === 'string' ? o.withheldReason : null,
  };
}

function ScoreBriefing({ scoreId }: { scoreId: string }) {
  const { t, dict, fmtDate, fmtTime } = useI18n();
  const { data, loading, error, reload } = useResource(() => api.scoreBriefing(scoreId), [scoreId]);

  if (loading) return <SkeletonCard />;
  if (error) return <ErrorPanel message={t('assess.briefingFailed')} onRetry={reload} />;
  if (!data) {
    // Honest: no briefing has been generated — never a fabricated one.
    return <EmptyState eyebrow={t('assess.briefingEyebrow')} body={t('assess.briefingNone')} />;
  }

  const out = parseBriefingOutput(data.output);
  const decisionLabel =
    dict.assess.briefingDecisions[data.humanDecision as keyof typeof dict.assess.briefingDecisions] ??
    data.humanDecision;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="eyebrow">{t('assess.briefingEyebrow')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {out.source === 'ai' && <span className="chip border border-teal/25 text-teal-soft">{t('assess.briefingSourceAi')}</span>}
          {out.source === 'rule-based' && <span className="chip">{t('assess.briefingSourceRule')}</span>}
          <span className="chip text-mist/60">{decisionLabel}</span>
        </div>
      </div>

      {/* Honest label: assistive draft, behind the clinician's decision. */}
      <p className="mt-2 text-[11px] leading-relaxed text-mist/50">{t('assess.briefingDraft')}</p>
      {out.source === 'rule-based' && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-mist/50">{t('assess.briefingRuleNote')}</p>
      )}

      {out.interpretation ? (
        <div className="card-inset mt-3 p-3.5">
          <p className="text-sm leading-relaxed text-mist/80">{out.interpretation}</p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-mist/55">—</p>
      )}
      {out.withheldReason && (
        <p className="mt-3 rounded border border-signal/30 bg-signal/[0.05] px-3 py-2 text-xs text-mist/75">
          {t('assess.briefingWithheld', { reason: out.withheldReason })}
        </p>
      )}

      <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-haze/70" dir="ltr">
        {fmtDate(data.createdAt)} {fmtTime(data.createdAt)}
      </p>
    </section>
  );
}
