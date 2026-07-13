'use client';

/**
 * Admin portal (contexts 2/27 + registries 3/4) — ADMIN-only (middleware
 * gates the route on admin:config; the API guards every endpoint again).
 *
 * Four surfaces:
 *  - Tenant profile (PATCH /admin/tenant)
 *  - Clinic network (GET/POST/PATCH /admin/clinics)
 *  - Feature flags (GET/PUT /admin/feature-flags) — the EU-AI-Act
 *    KILL-SWITCH seam, so every toggle is a deliberate two-step confirm.
 *  - Client + Psychologist registries (cursor-paginated {items,nextCursor};
 *    create / edit / SOFT-delete with confirmation — rows are never erased).
 */
import { useCallback, useEffect, useState } from 'react';
import type {
  ClientRegistryDto,
  ClinicDto,
  FeatureFlagDto,
  PsychologistRegistryDto,
  TenantDto,
} from '@vpsy/contracts';
import { api, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { SkeletonCard, SkeletonStack } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { DataTable, type DataColumn } from '@/components/DataTable';
import { ContextPanel } from '@/components/ContextPanel';
import { StatTile } from '@/components/StatTile';

const CLINIC_TYPES = ['VIRTUAL', 'PHYSICAL', 'HYBRID'] as const;
const CLIENT_STATUSES = ['active', 'inactive', 'discharged'] as const;

export default function AdminPage() {
  const { t, fmtNumber } = useI18n();
  const tenant = useResource<TenantDto>(() => api.adminTenant(), []);
  const clinics = useResource<ClinicDto[]>(() => api.adminClinics(), []);
  const flags = useResource<FeatureFlagDto[]>(() => api.adminFeatureFlags(), []);

  const errorMessage =
    tenant.error instanceof ApiError
      ? t('adminPortal.errStatus', { status: tenant.error.status })
      : t('adminPortal.errNetwork');

  return (
    <div>
      <p className="eyebrow">{t('adminPortal.eyebrow')}</p>
      <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('adminPortal.title')}</h1>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('adminPortal.intro')}</p>

      {tenant.loading && <SkeletonStack count={2} className="mt-6 space-y-3" />}
      {!tenant.loading && !!tenant.error && (
        <ErrorPanel className="mt-6 max-w-md" message={errorMessage} onRetry={tenant.reload} />
      )}

      {!tenant.loading && !tenant.error && tenant.data && (
        <div className="mt-6 grid gap-6 xl:grid-cols-2">
          <TenantCard tenant={tenant.data} onSaved={tenant.reload} />
          <FlagsCard flags={flags} />
          <ClinicsCard clinics={clinics} />
          <DocumentsCapabilityCard />
        </div>
      )}

      <div className="mt-8 space-y-8">
        <ClientRegistrySection />
        <PsychologistRegistrySection />
      </div>

      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('adminPortal.eyebrow')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('adminPortal.clinicsEyebrow')} value={clinics.data ? fmtNumber(clinics.data.length) : '—'} />
            <StatTile
              label={t('adminPortal.flagsEyebrow')}
              value={flags.data ? fmtNumber(flags.data.length) : '—'}
            />
          </div>
        </section>
      </ContextPanel>
    </div>
  );
}

/* ────────────────────────── Tenant profile ────────────────────────── */

function TenantCard({ tenant, onSaved }: { tenant: TenantDto; onSaved: () => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(tenant.name);
  const [country, setCountry] = useState(tenant.countryCode);
  const [residency, setResidency] = useState(tenant.residencyRegion);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.adminPatchTenant({
        ...(name !== tenant.name ? { name } : {}),
        ...(country !== tenant.countryCode ? { countryCode: country } : {}),
        ...(residency !== tenant.residencyRegion ? { residencyRegion: residency } : {}),
      });
      setMsg({ text: t('adminPortal.saved'), ok: true });
      onSaved();
    } catch {
      setMsg({ text: t('adminPortal.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('adminPortal.tenantEyebrow')}</p>
      <div className="mt-4 space-y-3">
        <div>
          <label htmlFor="tenant-name" className="field-label">{t('adminPortal.tenantName')}</label>
          <input id="tenant-name" className="field text-sm" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="tenant-country" className="field-label">{t('adminPortal.tenantCountry')}</label>
            <input
              id="tenant-country"
              className="field text-sm uppercase"
              dir="ltr"
              maxLength={2}
              value={country}
              onChange={(e) => setCountry(e.target.value.toUpperCase())}
            />
          </div>
          <div>
            <label htmlFor="tenant-residency" className="field-label">{t('adminPortal.tenantResidency')}</label>
            <input id="tenant-residency" className="field text-sm" dir="ltr" value={residency} onChange={(e) => setResidency(e.target.value)} />
          </div>
        </div>
        <p className="text-[11px] text-mist/50">
          {t('adminPortal.tenantStatus')}: <span className="chip ms-1">{tenant.status}</span>
        </p>
      </div>
      <button type="button" onClick={save} disabled={busy || name.trim().length < 2} className="btn-primary mt-4 disabled:opacity-60">
        {busy ? t('adminPortal.saving') : t('adminPortal.save')}
      </button>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>
      )}
    </section>
  );
}

/* ────────────────────── Feature flags (kill switch) ────────────────────── */

function DocumentsCapabilityCard() {
  const { t } = useI18n();
  const status = useResource(() => api.documentsStatus(), []);
  const modeLabel =
    status.data?.mode === 'blob'
      ? t('documents.modeBlob')
      : status.data?.mode === 'metadata-only'
        ? t('documents.modeMetadata')
        : t('documents.modeDisabled');

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('documents.eyebrow')}</p>
      <h2 className="mt-1.5 font-display text-lg text-mist">{t('documents.title')}</h2>
      <p className="mt-2 text-xs leading-relaxed text-mist/55">{t('documents.honesty')}</p>
      {status.loading && <SkeletonCard className="mt-4" />}
      {!!status.error && (
        <ErrorPanel className="mt-4" message={t('adminPortal.errNetwork')} onRetry={status.reload} />
      )}
      {status.data && (
        <div className="mt-4 space-y-2">
          <p className="text-sm text-mist/85">
            <span className="font-mono text-xs uppercase tracking-wider text-haze/90">mode · </span>
            {modeLabel}
          </p>
          <p className="text-sm text-mist/70">{status.data.message}</p>
          <ul className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
            <li className="card-inset p-2">
              <p className="text-mist/50">{t('documents.canUpload')}</p>
              <p className="mt-1 font-medium text-mist">{status.data.canUpload ? t('documents.yes') : t('documents.no')}</p>
            </li>
            <li className="card-inset p-2">
              <p className="text-mist/50">{t('documents.canDownload')}</p>
              <p className="mt-1 font-medium text-mist">{status.data.canDownload ? t('documents.yes') : t('documents.no')}</p>
            </li>
            <li className="card-inset p-2">
              <p className="text-mist/50">{t('documents.virusScan')}</p>
              <p className="mt-1 font-medium text-mist">{status.data.virusScan ? t('documents.yes') : t('documents.no')}</p>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
}

function FlagsCard({ flags }: { flags: ReturnType<typeof useResource<FeatureFlagDto[]>> }) {
  const { t, fmtDate } = useI18n();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');

  async function toggle(flag: FeatureFlagDto) {
    setBusyKey(flag.key);
    setErr(null);
    try {
      await api.adminUpsertFeatureFlag({ key: flag.key, enabled: !flag.enabled });
      flags.reload();
    } catch {
      setErr(t('adminPortal.toggleFailed'));
    } finally {
      setBusyKey(null);
      setConfirming(null);
    }
  }

  async function addFlag() {
    const key = newKey.trim();
    if (key.length < 2) return;
    setBusyKey(key);
    setErr(null);
    try {
      // New flags always start DISABLED — enabling is a separate, confirmed act.
      await api.adminUpsertFeatureFlag({ key, enabled: false });
      setNewKey('');
      flags.reload();
    } catch {
      setErr(t('adminPortal.toggleFailed'));
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section className="card p-5">
      <p className="eyebrow text-signal-soft/90">{t('adminPortal.flagsEyebrow')}</p>
      <p className="mt-2 text-xs leading-relaxed text-mist/55">{t('adminPortal.flagsIntro')}</p>

      {flags.loading && <SkeletonCard className="mt-4" />}
      {!flags.loading && !!flags.error && (
        <ErrorPanel className="mt-4" message={t('adminPortal.errNetwork')} onRetry={flags.reload} />
      )}
      {!flags.loading && !flags.error && (flags.data?.length ?? 0) === 0 && (
        <EmptyState className="mt-4" body={t('adminPortal.noFlags')} />
      )}
      {(flags.data?.length ?? 0) > 0 && (
        <ul className="mt-4 space-y-2">
          {flags.data!.map((f) => {
            const actionLabel = f.enabled ? t('adminPortal.disable') : t('adminPortal.enable');
            return (
              <li key={f.id} className="card-inset p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-mist" dir="ltr">{f.key}</p>
                    <p className="mt-0.5 text-[11px] text-mist/50">
                      {t('adminPortal.flagUpdated', { date: fmtDate(f.updatedAt) })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className={`chip ${f.enabled ? 'border-teal/40 text-teal-soft' : 'chip-signal'}`}>
                      {f.enabled ? t('adminPortal.flagEnabled') : t('adminPortal.flagDisabled')}
                    </span>
                    {confirming !== f.key ? (
                      <button
                        type="button"
                        onClick={() => setConfirming(f.key)}
                        disabled={busyKey !== null}
                        className="btn-ghost px-2.5 py-1.5 text-xs disabled:opacity-60"
                      >
                        {actionLabel}
                      </button>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => toggle(f)}
                          disabled={busyKey !== null}
                          className="rounded border border-signal/50 bg-signal/10 px-2.5 py-1.5 text-xs font-medium text-signal transition hover:bg-signal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60"
                        >
                          {t('adminPortal.confirm')}
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirming(null)}
                          className="btn-ghost px-2.5 py-1.5 text-xs"
                        >
                          {t('adminPortal.cancel')}
                        </button>
                      </span>
                    )}
                  </div>
                </div>
                {confirming === f.key && (
                  <p className="mt-2 text-[11px] text-signal-soft">
                    {t('adminPortal.confirmToggle', {
                      action: f.enabled ? t('adminPortal.flagActionDisable') : t('adminPortal.flagActionEnable'),
                      key: f.key,
                    })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="new-flag-key" className="sr-only">{t('adminPortal.newFlagKey')}</label>
          <input
            id="new-flag-key"
            className="field font-mono text-xs"
            dir="ltr"
            placeholder={t('adminPortal.newFlagKey')}
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
          />
        </div>
        <button
          type="button"
          onClick={addFlag}
          disabled={busyKey !== null || newKey.trim().length < 2}
          className="btn-ghost shrink-0 px-3 text-xs disabled:opacity-60"
        >
          {t('adminPortal.addFlag')}
        </button>
      </div>
      {err && <p role="alert" className="mt-2 text-xs text-risk">{err}</p>}
    </section>
  );
}

/* ────────────────────────── Clinic network ────────────────────────── */

function ClinicsCard({ clinics }: { clinics: ReturnType<typeof useResource<ClinicDto[]>> }) {
  const { t, dict } = useI18n();
  const [name, setName] = useState('');
  const [type, setType] = useState<(typeof CLINIC_TYPES)[number]>('VIRTUAL');
  const [timezone, setTimezone] = useState('UTC');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editType, setEditType] = useState<(typeof CLINIC_TYPES)[number]>('VIRTUAL');
  const [editTz, setEditTz] = useState('UTC');

  async function add() {
    if (name.trim().length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.adminCreateClinic({ name: name.trim(), type, timezone });
      setName('');
      setMsg({ text: t('adminPortal.clinicAdded'), ok: true });
      clinics.reload();
    } catch {
      setMsg({ text: t('adminPortal.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.adminPatchClinic(id, { name: editName.trim(), type: editType, timezone: editTz });
      setEditingId(null);
      setMsg({ text: t('adminPortal.saved'), ok: true });
      clinics.reload();
    } catch {
      setMsg({ text: t('adminPortal.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 xl:col-span-2">
      <p className="eyebrow">{t('adminPortal.clinicsEyebrow')}</p>

      {clinics.loading && <SkeletonCard className="mt-4" />}
      {!clinics.loading && !!clinics.error && (
        <ErrorPanel className="mt-4" message={t('adminPortal.errNetwork')} onRetry={clinics.reload} />
      )}
      {!clinics.loading && !clinics.error && (clinics.data?.length ?? 0) === 0 && (
        <EmptyState className="mt-4" body={t('adminPortal.noClinics')} />
      )}
      {(clinics.data?.length ?? 0) > 0 && (
        <ul className="mt-4 space-y-2">
          {clinics.data!.map((c) => (
            <li key={c.id} className="card-inset p-3">
              {editingId === c.id ? (
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
                  <input
                    aria-label={t('adminPortal.clinicName')}
                    className="field text-sm"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <select
                    aria-label={t('adminPortal.clinicType')}
                    className="field text-sm"
                    value={editType}
                    onChange={(e) => setEditType(e.target.value as (typeof CLINIC_TYPES)[number])}
                  >
                    {CLINIC_TYPES.map((ct) => (
                      <option key={ct} value={ct}>{dict.adminPortal.clinicTypes[ct]}</option>
                    ))}
                  </select>
                  <input
                    aria-label={t('adminPortal.clinicTimezone')}
                    className="field text-sm"
                    dir="ltr"
                    value={editTz}
                    onChange={(e) => setEditTz(e.target.value)}
                  />
                  <span className="flex items-center gap-1.5">
                    <button type="button" onClick={() => saveEdit(c.id)} disabled={busy} className="btn-primary px-3 py-2 text-xs disabled:opacity-60">
                      {t('adminPortal.save')}
                    </button>
                    <button type="button" onClick={() => setEditingId(null)} className="btn-ghost px-3 py-2 text-xs">
                      {t('adminPortal.cancel')}
                    </button>
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-mist">{c.name}</p>
                    <p className="mt-0.5 text-[11px] text-mist/55">
                      {dict.adminPortal.clinicTypes[c.type as (typeof CLINIC_TYPES)[number]] ?? c.type}
                      {' · '}
                      <span dir="ltr">{c.timezone}</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingId(c.id);
                      setEditName(c.name);
                      setEditType((CLINIC_TYPES as readonly string[]).includes(c.type) ? (c.type as (typeof CLINIC_TYPES)[number]) : 'VIRTUAL');
                      setEditTz(c.timezone);
                    }}
                    className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs"
                  >
                    {t('adminPortal.edit')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="hairline-t mt-4 grid gap-2 pt-4 sm:grid-cols-[1fr_auto_auto_auto]">
        <div>
          <label htmlFor="clinic-name" className="sr-only">{t('adminPortal.clinicName')}</label>
          <input id="clinic-name" className="field text-sm" placeholder={t('adminPortal.clinicName')} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <select
          aria-label={t('adminPortal.clinicType')}
          className="field text-sm"
          value={type}
          onChange={(e) => setType(e.target.value as (typeof CLINIC_TYPES)[number])}
        >
          {CLINIC_TYPES.map((ct) => (
            <option key={ct} value={ct}>{dict.adminPortal.clinicTypes[ct]}</option>
          ))}
        </select>
        <input
          aria-label={t('adminPortal.clinicTimezone')}
          className="field text-sm"
          dir="ltr"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        />
        <button type="button" onClick={add} disabled={busy || name.trim().length < 2} className="btn-primary px-4 text-sm disabled:opacity-60">
          {busy ? t('adminPortal.adding') : t('adminPortal.addClinic')}
        </button>
      </div>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>
      )}
    </section>
  );
}

/* ─────────────────── Cursor-paginated registry helper ─────────────────── */

function usePagedRegistry<T>(fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>) {
  const [items, setItems] = useState<T[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadFirst = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await fetchPage();
      setItems(page.items);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setMore(true);
    try {
      const page = await fetchPage(nextCursor);
      setItems((cur) => [...(cur ?? []), ...page.items]);
      setNextCursor(page.nextCursor);
    } catch (e) {
      setError(e);
    } finally {
      setMore(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCursor]);

  useEffect(() => {
    loadFirst();
  }, [loadFirst]);

  return { items, nextCursor, loading, more, error, loadFirst, loadMore };
}

/** Two-step inline confirm for the soft-delete action. */
function SoftDeleteButton({
  name,
  onConfirm,
  disabled,
}: {
  name: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [arming, setArming] = useState(false);
  if (!arming) {
    return (
      <button type="button" onClick={() => setArming(true)} disabled={disabled} className="btn-ghost px-2 py-1 text-[11px] disabled:opacity-60">
        {t('adminPortal.softDelete')}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <span className="text-[11px] text-signal-soft">{t('adminPortal.softDeleteConfirm', { name })}</span>
      <span className="inline-flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            setArming(false);
            onConfirm();
          }}
          disabled={disabled}
          className="rounded border border-signal/50 bg-signal/10 px-2 py-1 text-[11px] font-medium text-signal transition hover:bg-signal/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-signal disabled:opacity-60"
        >
          {t('adminPortal.confirm')}
        </button>
        <button type="button" onClick={() => setArming(false)} className="btn-ghost px-2 py-1 text-[11px]">
          {t('adminPortal.cancel')}
        </button>
      </span>
    </span>
  );
}

/* ────────────────────────── Client registry ────────────────────────── */

function ClientRegistrySection() {
  const { t, dict } = useI18n();
  const paged = usePagedRegistry<ClientRegistryDto>((cursor) => api.regListClients(cursor));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [language, setLanguage] = useState('en');

  // Edit panel
  const [editing, setEditing] = useState<ClientRegistryDto | null>(null);
  const [editLanguage, setEditLanguage] = useState('en');
  const [editContext, setEditContext] = useState('');
  const [editStatus, setEditStatus] = useState<(typeof CLIENT_STATUSES)[number]>('active');

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await api.regCreateClient({
        fullName: fullName.trim(),
        email: email.trim(),
        locale: language,
        timezone: 'UTC',
        preferredLanguage: language,
        demographics: {},
      });
      setFullName('');
      setEmail('');
      setMsg({ text: t('adminPortal.created'), ok: true });
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.createFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.regPatchClient(editing.id, {
        preferredLanguage: editLanguage,
        culturalContext: editContext.trim() || null,
        status: editStatus,
      });
      setEditing(null);
      setMsg({ text: t('adminPortal.updated'), ok: true });
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function softDelete(row: ClientRegistryDto) {
    setBusy(true);
    setMsg(null);
    try {
      await api.regDeleteClient(row.id);
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.deleteFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<ClientRegistryDto>[] = [
    { id: 'name', header: t('adminPortal.colName'), cell: (r) => <span className={r.deletedAt ? 'text-mist/45 line-through' : ''}>{r.fullName}</span> },
    { id: 'email', header: t('adminPortal.colEmail'), cell: (r) => <span dir="ltr" className="font-mono text-xs">{r.email}</span>, className: 'hidden md:table-cell' },
    {
      id: 'status',
      header: t('adminPortal.colStatus'),
      cell: (r) =>
        r.deletedAt ? (
          <span className="chip chip-signal">{t('adminPortal.deleted')}</span>
        ) : (
          <span className="chip">{dict.adminPortal.statuses[r.status as (typeof CLIENT_STATUSES)[number]] ?? r.status}</span>
        ),
    },
    {
      id: 'risk',
      header: t('adminPortal.colRisk'),
      cell: (r) => <span className={`chip ${r.riskLevel === 'SEVERE' ? 'border-risk/40 text-risk' : r.riskLevel === 'HIGH' ? 'chip-signal' : ''}`}>{dict.risk.severity[r.riskLevel as keyof typeof dict.risk.severity] ?? r.riskLevel}</span>,
      className: 'hidden sm:table-cell',
    },
    { id: 'lang', header: t('adminPortal.colLanguage'), cell: (r) => <span className="font-mono text-xs uppercase">{r.preferredLanguage}</span>, className: 'hidden lg:table-cell' },
    {
      id: 'actions',
      header: t('adminPortal.colActions'),
      cell: (r) =>
        r.deletedAt ? (
          <span className="text-xs text-mist/45">—</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(r);
                setEditLanguage(r.preferredLanguage);
                setEditContext(r.culturalContext ?? '');
                setEditStatus((CLIENT_STATUSES as readonly string[]).includes(r.status) ? (r.status as (typeof CLIENT_STATUSES)[number]) : 'active');
              }}
              className="btn-ghost px-2 py-1 text-[11px]"
            >
              {t('adminPortal.edit')}
            </button>
            <SoftDeleteButton name={r.fullName} onConfirm={() => softDelete(r)} disabled={busy} />
          </span>
        ),
    },
  ];

  return (
    <section>
      <p className="eyebrow mb-3">{t('adminPortal.clientsEyebrow')}</p>
      {paged.loading && <SkeletonCard />}
      {!paged.loading && !!paged.error && (
        <ErrorPanel message={t('adminPortal.errNetwork')} onRetry={paged.loadFirst} />
      )}
      {!paged.loading && !paged.error && paged.items && (
        <>
          <DataTable
            columns={columns}
            rows={paged.items}
            rowKey={(r) => r.id}
            caption={t('adminPortal.clientsEyebrow')}
            empty={t('adminPortal.noClients')}
          />
          {paged.nextCursor && (
            <button type="button" onClick={paged.loadMore} disabled={paged.more} className="btn-ghost mt-3 px-3 py-1.5 text-xs disabled:opacity-60">
              {paged.more ? t('adminPortal.loadingMore') : t('adminPortal.loadMore')}
            </button>
          )}
        </>
      )}

      {editing && (
        <div className="card mt-4 max-w-xl p-4">
          <p className="eyebrow">{t('adminPortal.editRecord', { name: editing.fullName })}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor="cl-edit-lang" className="field-label">{t('adminPortal.preferredLanguage')}</label>
              <input id="cl-edit-lang" className="field text-sm" dir="ltr" value={editLanguage} onChange={(e) => setEditLanguage(e.target.value)} />
            </div>
            <div>
              <label htmlFor="cl-edit-status" className="field-label">{t('adminPortal.statusField')}</label>
              <select id="cl-edit-status" className="field text-sm" value={editStatus} onChange={(e) => setEditStatus(e.target.value as (typeof CLIENT_STATUSES)[number])}>
                {CLIENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{dict.adminPortal.statuses[s]}</option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="cl-edit-context" className="field-label">{t('adminPortal.culturalContext')}</label>
              <input id="cl-edit-context" className="field text-sm" value={editContext} onChange={(e) => setEditContext(e.target.value)} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={saveEdit} disabled={busy} className="btn-primary px-3 py-2 text-xs disabled:opacity-60">
              {busy ? t('adminPortal.saving') : t('adminPortal.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-ghost px-3 py-2 text-xs">
              {t('adminPortal.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card mt-4 max-w-xl p-4">
        <p className="eyebrow">{t('adminPortal.newClientEyebrow')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="cl-new-name" className="field-label">{t('adminPortal.fullName')}</label>
            <input id="cl-new-name" className="field text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cl-new-email" className="field-label">{t('adminPortal.email')}</label>
            <input id="cl-new-email" type="email" className="field text-sm" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="cl-new-lang" className="field-label">{t('adminPortal.preferredLanguage')}</label>
            <input id="cl-new-lang" className="field text-sm" dir="ltr" value={language} onChange={(e) => setLanguage(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy || fullName.trim().length < 2 || !email.includes('@')}
          className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy ? t('adminPortal.creating') : t('adminPortal.create')}
        </button>
      </div>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>
      )}
    </section>
  );
}

/* ──────────────────────── Psychologist registry ──────────────────────── */

function PsychologistRegistrySection() {
  const { t, fmtNumber } = useI18n();
  const paged = usePagedRegistry<PsychologistRegistryDto>((cursor) => api.regListPsychologists(cursor));
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  // Create form
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [specialties, setSpecialties] = useState('');
  const [languages, setLanguages] = useState('en');

  // Edit panel
  const [editing, setEditing] = useState<PsychologistRegistryDto | null>(null);
  const [editSpecialties, setEditSpecialties] = useState('');
  const [editLanguages, setEditLanguages] = useState('');
  const [editCap, setEditCap] = useState(30);
  const [editAccepting, setEditAccepting] = useState(true);

  const splitCsv = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      await api.regCreatePsychologist({
        fullName: fullName.trim(),
        email: email.trim(),
        locale: 'en',
        timezone: 'UTC',
        specialties: splitCsv(specialties),
        languages: splitCsv(languages).length > 0 ? splitCsv(languages) : ['en'],
        caseloadCap: 30,
      });
      setFullName('');
      setEmail('');
      setSpecialties('');
      setMsg({ text: t('adminPortal.created'), ok: true });
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.createFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    try {
      await api.regPatchPsychologist(editing.id, {
        specialties: splitCsv(editSpecialties),
        languages: splitCsv(editLanguages),
        caseloadCap: editCap,
        acceptingClients: editAccepting,
      });
      setEditing(null);
      setMsg({ text: t('adminPortal.updated'), ok: true });
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.saveFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  async function softDelete(row: PsychologistRegistryDto) {
    setBusy(true);
    setMsg(null);
    try {
      await api.regDeletePsychologist(row.id);
      paged.loadFirst();
    } catch {
      setMsg({ text: t('adminPortal.deleteFailed'), ok: false });
    } finally {
      setBusy(false);
    }
  }

  const columns: DataColumn<PsychologistRegistryDto>[] = [
    { id: 'name', header: t('adminPortal.colName'), cell: (r) => <span className={r.deletedAt ? 'text-mist/45 line-through' : ''}>{r.fullName}</span> },
    { id: 'email', header: t('adminPortal.colEmail'), cell: (r) => <span dir="ltr" className="font-mono text-xs">{r.email}</span>, className: 'hidden md:table-cell' },
    {
      id: 'caseload',
      header: t('adminPortal.colCaseload'),
      numeric: true,
      cell: (r) => `${fmtNumber(r.currentCaseload)} / ${fmtNumber(r.caseloadCap)}`,
    },
    {
      id: 'accepting',
      header: t('adminPortal.colAccepting'),
      cell: (r) => <span className={`chip ${r.acceptingClients ? 'border-teal/40 text-teal-soft' : ''}`}>{r.acceptingClients ? t('adminPortal.yes') : t('adminPortal.no')}</span>,
      className: 'hidden sm:table-cell',
    },
    {
      id: 'credential',
      header: t('adminPortal.colCredential'),
      cell: (r) =>
        r.credentialSummary ? (
          <span className="chip" dir="ltr">
            {r.credentialSummary.jurisdiction} · {r.credentialSummary.verificationStatus}
          </span>
        ) : (
          <span className="text-xs text-mist/45">—</span>
        ),
      className: 'hidden lg:table-cell',
    },
    {
      id: 'actions',
      header: t('adminPortal.colActions'),
      cell: (r) =>
        r.deletedAt ? (
          <span className="chip chip-signal">{t('adminPortal.deleted')}</span>
        ) : (
          <span className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setEditing(r);
                setEditSpecialties(r.specialties.join(', '));
                setEditLanguages(r.languages.join(', '));
                setEditCap(r.caseloadCap);
                setEditAccepting(r.acceptingClients);
              }}
              className="btn-ghost px-2 py-1 text-[11px]"
            >
              {t('adminPortal.edit')}
            </button>
            <SoftDeleteButton name={r.fullName} onConfirm={() => softDelete(r)} disabled={busy} />
          </span>
        ),
    },
  ];

  return (
    <section>
      <p className="eyebrow mb-3">{t('adminPortal.psychsEyebrow')}</p>
      {paged.loading && <SkeletonCard />}
      {!paged.loading && !!paged.error && (
        <ErrorPanel message={t('adminPortal.errNetwork')} onRetry={paged.loadFirst} />
      )}
      {!paged.loading && !paged.error && paged.items && (
        <>
          <DataTable
            columns={columns}
            rows={paged.items}
            rowKey={(r) => r.id}
            caption={t('adminPortal.psychsEyebrow')}
            empty={t('adminPortal.noPsychs')}
          />
          {paged.nextCursor && (
            <button type="button" onClick={paged.loadMore} disabled={paged.more} className="btn-ghost mt-3 px-3 py-1.5 text-xs disabled:opacity-60">
              {paged.more ? t('adminPortal.loadingMore') : t('adminPortal.loadMore')}
            </button>
          )}
        </>
      )}

      {editing && (
        <div className="card mt-4 max-w-xl p-4">
          <p className="eyebrow">{t('adminPortal.editRecord', { name: editing.fullName })}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="ps-edit-spec" className="field-label">{t('adminPortal.specialties')}</label>
              <input id="ps-edit-spec" className="field text-sm" value={editSpecialties} onChange={(e) => setEditSpecialties(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ps-edit-langs" className="field-label">{t('adminPortal.languages')}</label>
              <input id="ps-edit-langs" className="field text-sm" dir="ltr" value={editLanguages} onChange={(e) => setEditLanguages(e.target.value)} />
            </div>
            <div>
              <label htmlFor="ps-edit-cap" className="field-label">{t('adminPortal.caseloadCap')}</label>
              <input
                id="ps-edit-cap"
                type="number"
                min={1}
                max={500}
                className="field text-sm"
                dir="ltr"
                value={editCap}
                onChange={(e) => setEditCap(Math.max(1, Math.min(500, Number(e.target.value) || 1)))}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-mist/70">
              <input type="checkbox" checked={editAccepting} onChange={(e) => setEditAccepting(e.target.checked)} />
              {t('adminPortal.acceptingClients')}
            </label>
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={saveEdit} disabled={busy} className="btn-primary px-3 py-2 text-xs disabled:opacity-60">
              {busy ? t('adminPortal.saving') : t('adminPortal.save')}
            </button>
            <button type="button" onClick={() => setEditing(null)} className="btn-ghost px-3 py-2 text-xs">
              {t('adminPortal.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="card mt-4 max-w-xl p-4">
        <p className="eyebrow">{t('adminPortal.newPsychEyebrow')}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ps-new-name" className="field-label">{t('adminPortal.fullName')}</label>
            <input id="ps-new-name" className="field text-sm" value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ps-new-email" className="field-label">{t('adminPortal.email')}</label>
            <input id="ps-new-email" type="email" className="field text-sm" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ps-new-spec" className="field-label">{t('adminPortal.specialties')}</label>
            <input id="ps-new-spec" className="field text-sm" value={specialties} onChange={(e) => setSpecialties(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ps-new-langs" className="field-label">{t('adminPortal.languages')}</label>
            <input id="ps-new-langs" className="field text-sm" dir="ltr" value={languages} onChange={(e) => setLanguages(e.target.value)} />
          </div>
        </div>
        <button
          type="button"
          onClick={create}
          disabled={busy || fullName.trim().length < 2 || !email.includes('@')}
          className="btn-primary mt-3 px-4 py-2 text-sm disabled:opacity-60"
        >
          {busy ? t('adminPortal.creating') : t('adminPortal.create')}
        </button>
      </div>
      {msg && (
        <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>
      )}
    </section>
  );
}
