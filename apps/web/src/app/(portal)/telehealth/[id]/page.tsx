'use client';

/**
 * Telehealth room (/telehealth/:id) — the TeleSession lifecycle surface.
 *
 * WAITING ROOM is honored exactly as the backend defines it (doc 08 §5/§6):
 * - A CLIENT's join lands them in WAITING_ROOM with `token: null` — authed
 *   but NO media. This page shows a calm waiting state and polls the session
 *   (REST, every few seconds — there is no TeleSession realtime event on the
 *   curated bridge) until the clinician admits; the client's next join then
 *   mints their token server-side.
 * - The PSYCHOLOGIST sees who is waiting and an Admit button; admitting
 *   flips the session IN_PROGRESS. Their own media token comes from their
 *   own join call.
 * - An unconfigured video provider surfaces as the API's honest
 *   503 VIDEO_NOT_CONFIGURED — shown as exactly that; the lifecycle
 *   (waiting room, admission, end) still works without media.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import type { LiveKitTokenDto, TeleSessionDto } from '@vpsy/contracts';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { ContextPanel } from '@/components/ContextPanel';

// Media APIs are browser-only — never render VideoRoom during SSR.
const VideoRoom = dynamic(() => import('@/components/VideoRoom'), { ssr: false });

const POLL_MS = 4_000;

function isVideoNotConfigured(e: unknown): boolean {
  return (
    e instanceof ApiError &&
    e.status === 503 &&
    typeof e.body === 'object' &&
    e.body !== null &&
    String((e.body as { title?: string }).title ?? '').includes('VIDEO_NOT_CONFIGURED')
  );
}

export default function TelehealthRoomPage() {
  const { t, dict, fmtTime } = useI18n();
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => {
    setRoles(getPrincipal()?.roles ?? []);
  }, []);
  const isPsychologist = roles.includes('PSYCHOLOGIST');
  const isClient = roles.includes('CLIENT');

  const [session, setSession] = useState<TeleSessionDto | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [token, setToken] = useState<LiveKitTokenDto | null>(null);
  const [videoUnconfigured, setVideoUnconfigured] = useState(false);
  const [busy, setBusy] = useState<'join' | 'admit' | 'end' | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  // The CLIENT clicked Join at least once — enables the auto re-join once
  // the clinician admits (their token is minted on that second join).
  const [clientJoined, setClientJoined] = useState(false);

  const load = useCallback(async () => {
    setLoadErr(null);
    try {
      setSession(await api.teleGet(id));
    } catch (e) {
      setLoadErr(e instanceof ApiError ? t('tele.errStatus', { status: e.status }) : t('tele.errNetwork'));
    }
  }, [id, t]);

  useEffect(() => {
    if (id) load();
  }, [id, load]);

  // Honest low-frequency poll while the session can still change and we hold
  // no media connection (the room itself is the live signal once connected).
  const active = session && session.status !== 'ENDED' && session.status !== 'CANCELLED';
  useEffect(() => {
    if (!active || token) return;
    const h = setInterval(load, POLL_MS);
    return () => clearInterval(h);
  }, [active, token, load]);

  const join = useCallback(async () => {
    setBusy('join');
    setActionErr(null);
    try {
      const result = await api.teleJoin(id);
      setSession(result.session);
      setToken(result.token);
      if (isClient) setClientJoined(true);
    } catch (e) {
      if (isVideoNotConfigured(e)) setVideoUnconfigured(true);
      else setActionErr(t('tele.actionFailed'));
    } finally {
      setBusy(null);
    }
  }, [id, isClient, t]);

  // Client auto re-join: admitted while waiting → the next join mints their
  // token. Runs once per admission (guarded by token/busy).
  const autoJoinRef = useRef(false);
  useEffect(() => {
    if (
      isClient &&
      clientJoined &&
      !token &&
      !videoUnconfigured &&
      session?.status === 'IN_PROGRESS' &&
      !autoJoinRef.current
    ) {
      autoJoinRef.current = true;
      join().finally(() => {
        autoJoinRef.current = false;
      });
    }
  }, [isClient, clientJoined, token, videoUnconfigured, session?.status, join]);

  async function admit() {
    setBusy('admit');
    setActionErr(null);
    try {
      const result = await api.teleAdmit(id);
      setSession(result.session);
      // The admit response carries the CLIENT's token (relayed server-side to
      // their own next join) — never ours. Mint our own via join.
      if (!token && !videoUnconfigured) await join();
    } catch (e) {
      if (isVideoNotConfigured(e)) setVideoUnconfigured(true);
      else setActionErr(t('tele.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  async function end() {
    setBusy('end');
    setActionErr(null);
    try {
      setToken(null);
      setSession(await api.teleEnd(id));
    } catch {
      setActionErr(t('tele.actionFailed'));
    } finally {
      setBusy(null);
    }
  }

  const statusLabel = session ? dict.tele.status[session.status] ?? session.status : null;
  const waitingEvent = session?.participantEvents
    .filter((e) => e.who === 'CLIENT' && e.event.includes('waiting'))
    .at(-1);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('tele.roomEyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('tele.roomTitle')}</h1>
        </div>
        {session && (
          <span role="status" className={`chip ${session.status === 'IN_PROGRESS' ? 'border-teal/40 text-teal-soft' : ''}`}>
            {t('tele.statusLabel')}: {statusLabel}
          </span>
        )}
      </div>
      <p className="mt-2">
        <Link href="/telehealth" className="text-xs text-mist/60 underline decoration-line/40 underline-offset-4 transition hover:text-mist">
          {t('tele.backToList')}
        </Link>
      </p>

      <div className="mt-6 max-w-3xl space-y-4">
        {!session && !loadErr && <SkeletonCard />}
        {loadErr && <ErrorPanel message={loadErr} onRetry={load} />}

        {session && (
          <>
            {/* ── Terminal states ── */}
            {session.status === 'ENDED' && (
              <section className="card p-5">
                <p className="eyebrow">{t('tele.endedTitle')}</p>
                <p className="mt-2 text-sm leading-relaxed text-mist/70">{t('tele.endedBody')}</p>
              </section>
            )}
            {session.status === 'CANCELLED' && (
              <section className="card p-5">
                <p className="text-sm text-mist/70">{t('tele.cancelledBody')}</p>
              </section>
            )}

            {/* ── Live media (either role, once a token is held) ── */}
            {token && session.status === 'IN_PROGRESS' && (
              <section className="card p-4">
                <VideoRoom
                  url={token.url}
                  token={token.token}
                  onLeave={() => setToken(null)}
                  labels={{
                    connecting: t('tele.connecting'),
                    connectFailed: t('tele.connectFailed'),
                    reconnect: t('tele.reconnect'),
                    leave: t('tele.leave'),
                    mute: t('tele.mute'),
                    unmute: t('tele.unmute'),
                    cameraOff: t('tele.cameraOff'),
                    cameraOn: t('tele.cameraOn'),
                    youTile: t('tele.youTile'),
                    waitingForOther: t('tele.waitingForOther'),
                  }}
                />
                <p className="mt-3 text-[11px] text-mist/45">{t('tele.tokenExpiresNote')}</p>
              </section>
            )}

            {/* ── Honest "no video provider" state — lifecycle continues ── */}
            {videoUnconfigured && session.status !== 'ENDED' && session.status !== 'CANCELLED' && (
              <section className="rounded-md border border-signal/40 bg-signal/[0.06] p-5" role="status">
                <p className="eyebrow text-signal">{t('tele.videoNotConfiguredTitle')}</p>
                <p className="mt-2 max-w-xl text-sm leading-relaxed text-mist/70">{t('tele.videoNotConfiguredBody')}</p>
              </section>
            )}

            {/* ── CLIENT: calm waiting room ── */}
            {isClient && !token && session.status === 'WAITING_ROOM' && clientJoined && (
              <section className="card relative overflow-hidden p-6">
                <div className="pointer-events-none absolute inset-0 bg-aurora" aria-hidden />
                <div className="relative">
                  <p className="eyebrow">{t('tele.waitingTitle')}</p>
                  <p className="mt-3 max-w-xl text-sm leading-relaxed text-mist/70">{t('tele.waitingBody')}</p>
                  {waitingEvent && (
                    <p className="mt-3 font-mono text-[10px] uppercase tracking-wider text-haze/80" dir="ltr">
                      {t('tele.waitingSince', { time: fmtTime(waitingEvent.at) })}
                    </p>
                  )}
                  <span aria-hidden className="mt-4 block h-1 w-24 rounded-full bg-teal/40 animate-pulseline" />
                </div>
              </section>
            )}

            {/* ── CLIENT: join entry ── */}
            {isClient && !token && (session.status === 'SCHEDULED' || (session.status === 'WAITING_ROOM' && !clientJoined) || (session.status === 'IN_PROGRESS' && !videoUnconfigured)) && (
              <section className="card p-5">
                <p className="text-sm text-mist/70">{t('tele.notStartedClient')}</p>
                <button type="button" onClick={join} disabled={busy !== null} className="btn-primary mt-3 disabled:opacity-60">
                  {busy === 'join' ? t('tele.joining') : t('tele.join')}
                </button>
              </section>
            )}

            {/* ── PSYCHOLOGIST: waiting-room console ── */}
            {isPsychologist && !token && session.status !== 'ENDED' && session.status !== 'CANCELLED' && (
              <section className="card p-5">
                {session.status === 'WAITING_ROOM' ? (
                  <>
                    <p className="text-sm font-medium text-mist">{t('tele.clientWaiting')}</p>
                    {waitingEvent && (
                      <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-haze/80" dir="ltr">
                        {t('tele.waitingSince', { time: fmtTime(waitingEvent.at) })}
                      </p>
                    )}
                    <button type="button" onClick={admit} disabled={busy !== null} className="btn-primary mt-3 disabled:opacity-60">
                      {busy === 'admit' ? t('tele.admitting') : t('tele.admit')}
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-mist/70">{t('tele.noOneWaiting')}</p>
                    {!videoUnconfigured && (
                      <button type="button" onClick={join} disabled={busy !== null} className="btn-ghost mt-3 disabled:opacity-60">
                        {busy === 'join' ? t('tele.joining') : t('tele.join')}
                      </button>
                    )}
                  </>
                )}
              </section>
            )}

            {/* ── End session (either participant, while non-terminal) ── */}
            {session.status !== 'ENDED' && session.status !== 'CANCELLED' && (
              <div>
                <button type="button" onClick={end} disabled={busy !== null} className="btn-ghost text-sm disabled:opacity-60">
                  {busy === 'end' ? t('tele.ending') : t('tele.endSession')}
                </button>
              </div>
            )}

            {actionErr && <p role="alert" className="text-sm text-risk">{actionErr}</p>}
          </>
        )}
      </div>

      {/* ── Context panel: append-only participant-event timeline ── */}
      {session && session.participantEvents.length > 0 && (
        <ContextPanel>
          <section className="card p-4">
            <p className="eyebrow">{t('tele.eventsEyebrow')}</p>
            <ol className="mt-3 space-y-2">
              {session.participantEvents.map((e, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="min-w-0">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-haze">
                      {dict.tele.who[e.who] ?? e.who}
                    </span>
                    <span className="ms-2 text-mist/70">{e.event.replaceAll('_', ' ')}</span>
                  </span>
                  <span className="figure shrink-0 text-mist/55" dir="ltr">{fmtTime(e.at)}</span>
                </li>
              ))}
            </ol>
          </section>
        </ContextPanel>
      )}
    </div>
  );
}
