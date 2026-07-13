'use client';

/**
 * Secure Messaging (context 14) — client↔clinician text threads.
 *
 * Deliberately a SEPARATE route from /comms: that page is the staff
 * telephony/ops hub (click-to-call, SMS, media log); this is the calm,
 * patient-facing clinical correspondence channel. Messages are immutable
 * once sent (no edit/delete endpoints exist — the UI says so instead of
 * pretending), participant ABAC lives server-side, and the thread's
 * counterpart clinician always tracks the client's CURRENT assignment.
 *
 * Live updates: the realtime bridge maps Events.MessageSent to a body-free
 * CommsMessage envelope (ids only, PHI-minimized) — on receipt we reload the
 * thread list and, if the event's thread is open, the conversation itself
 * over the authenticated REST API.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RealtimeEventType, type MessageDto, type ThreadDto } from '@vpsy/contracts';
import { api, getPrincipal, ApiError } from '@/lib/api';
import { useI18n } from '@/i18n';
import { useResource } from '@/lib/use-resource';
import { useLiveRefresh } from '@/lib/live-events';
import type { CaseloadEntry } from '@/lib/clinical-types';
import { SkeletonStack, SkeletonCard } from '@/components/Skeleton';
import { ErrorPanel } from '@/components/ErrorPanel';
import { EmptyState } from '@/components/EmptyState';
import { ContextPanel } from '@/components/ContextPanel';
import { StatTile } from '@/components/StatTile';

const MAX_MESSAGE_LENGTH = 5_000;

export default function MessagesPage() {
  const { t, fmtNumber } = useI18n();

  // Role is a UI hint only (labels + which "start a conversation" affordance
  // to show) — the API enforces the real participant ABAC on every call.
  const [roles, setRoles] = useState<string[]>([]);
  const [myUserId, setMyUserId] = useState('');
  useEffect(() => {
    const p = getPrincipal();
    setRoles(p?.roles ?? []);
    setMyUserId(p?.sub ?? '');
  }, []);
  const isClient = roles.includes('CLIENT');
  const isPsychologist = roles.includes('PSYCHOLOGIST');

  const threadsRes = useResource<ThreadDto[]>(() => api.msgThreads(), []);
  const threads = threadsRes.data;
  const hasThreadsData = threads !== null;
  const showInitialThreadsLoading = threadsRes.loading && !hasThreadsData;
  const showBlockingThreadsError = !!threadsRes.error && !hasThreadsData;

  // Caseload → display names for a clinician's thread list (client sees
  // "Your clinician"). Managers/others simply get the honest id fallback.
  const caseloadRes = useResource<CaseloadEntry[]>(
    () => (isPsychologist ? api.myCaseload() : Promise.resolve([])),
    [isPsychologist],
  );
  const nameByClientId = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of caseloadRes.data ?? []) m.set(c.clientId, c.displayName);
    return m;
  }, [caseloadRes.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = threads?.find((th) => th.id === selectedId) ?? null;

  // Pick the first thread automatically once loaded (calm default: the most
  // recent conversation is open rather than an empty pane).
  useEffect(() => {
    if (!selectedId && threads && threads.length > 0) setSelectedId(threads[0]!.id);
  }, [threads, selectedId]);

  // Live push — a body-free envelope; reload the list (unread counts) and let
  // the open conversation refresh itself via the bump counter.
  const [liveBump, setLiveBump] = useState(0);
  useLiveRefresh([RealtimeEventType.CommsMessage], () => {
    threadsRes.reload();
    setLiveBump((n) => n + 1);
  });

  // ── Start-a-conversation affordances ──
  const [starting, setStarting] = useState<string | null>(null); // clientId or '' for self
  const [startErr, setStartErr] = useState<string | null>(null);
  const startThread = useCallback(
    async (clientId?: string) => {
      setStarting(clientId ?? '');
      setStartErr(null);
      try {
        const th = await api.msgCreateThread(clientId ? { clientId } : {});
        threadsRes.reload();
        setSelectedId(th.id);
      } catch {
        setStartErr(t('messages.startFailed'));
      } finally {
        setStarting(null);
      }
    },
    [t, threadsRes],
  );

  const threadLabel = useCallback(
    (th: ThreadDto): string => {
      if (isClient) return th.subject || t('messages.threadWithClinician');
      const name = nameByClientId.get(th.clientId);
      if (name) return name;
      return t('messages.threadClientFallback', { id: th.clientId.slice(-6) });
    },
    [isClient, nameByClientId, t],
  );

  const totalUnread = (threads ?? []).reduce((sum, th) => sum + th.unreadCount, 0);
  const errorMessage =
    threadsRes.error instanceof ApiError
      ? t('messages.errStatus', { status: threadsRes.error.status })
      : t('messages.errNetwork');

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('messages.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('messages.title')}</h1>
        </div>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-mist/60">{t('messages.intro')}</p>
      <p className="mt-2 max-w-3xl text-xs leading-relaxed text-mist/45">{t('messages.notMonitored')}</p>

      {showInitialThreadsLoading && <SkeletonStack count={3} className="mt-6 space-y-3" />}
      {showBlockingThreadsError && (
        <ErrorPanel className="mt-6 max-w-md" message={errorMessage} onRetry={threadsRes.reload} />
      )}

      {hasThreadsData && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
          {/* ── Thread list ── */}
          <div className="space-y-4">
            <section>
              <p className="eyebrow mb-3">{t('messages.threadsEyebrow')}</p>
              {threads.length === 0 ? (
                <EmptyState
                  body={isClient ? `${t('messages.noThreads')} ${t('messages.noThreadsClientHint')}` : t('messages.noThreads')}
                />
              ) : (
                <ul className="space-y-2">
                  {threads.map((th) => {
                    const active = th.id === selectedId;
                    return (
                      <li key={th.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(th.id)}
                          aria-current={active ? 'true' : undefined}
                          className={`w-full rounded-md border p-3 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal ${
                            active
                              ? 'border-teal/40 bg-teal/5'
                              : 'border-line/20 bg-console-800 hover:border-line/40'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <p className="min-w-0 truncate text-sm font-medium text-mist">{threadLabel(th)}</p>
                            {th.unreadCount > 0 && (
                              <span className="chip shrink-0 border-teal/40 bg-teal/10 text-teal-soft">
                                {t('messages.unreadCount', { n: fmtNumber(th.unreadCount) })}
                              </span>
                            )}
                          </div>
                          {th.lastMessage && (
                            <p className="mt-1 truncate text-xs text-mist/60">{th.lastMessage.body}</p>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            {/* Client: one calm button — the counterpart resolves from the
                current assignment server-side. Clinician: start from caseload. */}
            {isClient && threads.length === 0 && (
              <div>
                <button
                  type="button"
                  onClick={() => startThread()}
                  disabled={starting !== null}
                  className="btn-primary w-full disabled:opacity-60"
                >
                  {starting !== null ? t('messages.starting') : t('messages.startWithClinician')}
                </button>
              </div>
            )}
            {isPsychologist && (
              <section className="card p-4">
                <p className="eyebrow">{t('messages.newThreadEyebrow')}</p>
                {caseloadRes.loading && <p className="mt-2 text-xs text-mist/55">{t('messages.caseloadLoading')}</p>}
                {!caseloadRes.loading && (caseloadRes.data?.length ?? 0) === 0 && (
                  <p className="mt-2 text-xs text-mist/55">{t('messages.caseloadEmpty')}</p>
                )}
                {(caseloadRes.data?.length ?? 0) > 0 && (
                  <ul className="mt-3 space-y-1.5">
                    {caseloadRes.data!.map((c) => (
                      <li key={c.clientId} className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm text-mist/80">{c.displayName}</span>
                        <button
                          type="button"
                          onClick={() => startThread(c.clientId)}
                          disabled={starting !== null}
                          className="btn-ghost shrink-0 px-2.5 py-1.5 text-xs disabled:opacity-60"
                        >
                          {starting === c.clientId ? t('messages.starting') : t('messages.openThread')}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}
            {startErr && <p role="alert" className="text-xs text-risk">{startErr}</p>}
          </div>

          {/* ── Conversation ── */}
          <div className="min-w-0">
            {selected ? (
              <Conversation
                key={selected.id}
                thread={selected}
                label={threadLabel(selected)}
                myUserId={myUserId}
                liveBump={liveBump}
                onReadStateChanged={threadsRes.reload}
              />
            ) : (
              threads.length > 0 && <EmptyState body={t('messages.selectThread')} />
            )}
          </div>
        </div>
      )}

      <ContextPanel>
        <section className="card p-4">
          <p className="eyebrow">{t('messages.threadsEyebrow')}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <StatTile label={t('messages.threadsStat')} value={threads ? fmtNumber(threads.length) : '—'} />
            <StatTile label={t('messages.unreadStat')} value={threads ? fmtNumber(totalUnread) : '—'} />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-mist/50">{t('messages.immutableNote')}</p>
        </section>
      </ContextPanel>
    </div>
  );
}

/**
 * One open thread: newest page of messages (oldest→newest top-down), a
 * "load older" cursor walk, mark-as-read for incoming messages, and the
 * composer. Messages are IMMUTABLE — there is deliberately no edit/delete
 * affordance anywhere here.
 */
function Conversation({
  thread,
  label,
  myUserId,
  liveBump,
  onReadStateChanged,
}: {
  thread: ThreadDto;
  label: string;
  myUserId: string;
  liveBump: number;
  onReadStateChanged: () => void;
}) {
  const { t, fmtTime, fmtDate } = useI18n();
  const [messages, setMessages] = useState<MessageDto[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [olderBusy, setOlderBusy] = useState(false);
  const markedRef = useRef(new Set<string>());
  const endRef = useRef<HTMLDivElement>(null);

  const loadLatest = useCallback(async () => {
    setLoadErr(null);
    try {
      const page = await api.msgMessages(thread.id);
      // API returns newest-first; render oldest-first so reading flows down.
      setMessages([...page.messages].reverse());
      setNextCursor(page.nextCursor ?? null);
    } catch (e) {
      setLoadErr(
        e instanceof ApiError ? t('messages.errStatus', { status: e.status }) : t('messages.errNetwork'),
      );
    }
  }, [thread.id, t]);

  useEffect(() => {
    setMessages(null);
    markedRef.current.clear();
    loadLatest();
  }, [loadLatest]);

  // Live event while this thread is open → refresh the newest page.
  useEffect(() => {
    if (liveBump > 0) loadLatest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBump]);

  // Mark incoming unread messages read (idempotent server-side; a sender can
  // never mark their own). Then let the thread list refresh its badges.
  useEffect(() => {
    if (!messages || !myUserId) return;
    const unread = messages.filter(
      (m) => m.senderId !== myUserId && !m.readAt && !markedRef.current.has(m.id),
    );
    if (unread.length === 0) return;
    for (const m of unread) markedRef.current.add(m.id);
    Promise.allSettled(unread.map((m) => api.msgMarkRead(m.id))).then(() => onReadStateChanged());
  }, [messages, myUserId, onReadStateChanged]);

  // Keep the newest message in view when the page (re)loads or a send lands.
  const count = messages?.length ?? 0;
  useEffect(() => {
    if (count > 0) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  async function loadOlder() {
    if (!nextCursor) return;
    setOlderBusy(true);
    try {
      const page = await api.msgMessages(thread.id, nextCursor);
      setMessages((cur) => [...[...page.messages].reverse(), ...(cur ?? [])]);
      setNextCursor(page.nextCursor ?? null);
    } catch {
      setLoadErr(t('messages.errNetwork'));
    } finally {
      setOlderBusy(false);
    }
  }

  // ── Composer ──
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string | null>(null);

  async function send() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendErr(null);
    try {
      const sent = await api.msgSend(thread.id, body.slice(0, MAX_MESSAGE_LENGTH));
      setDraft('');
      setMessages((cur) => [...(cur ?? []), sent]);
      onReadStateChanged();
    } catch {
      setSendErr(t('messages.sendFailed'));
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="card flex min-h-[420px] flex-col">
      <div className="hairline-b flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="eyebrow">{t('messages.conversationEyebrow')}</p>
          <p className="mt-0.5 truncate text-sm font-medium text-mist">{label}</p>
        </div>
      </div>

      <div className="max-h-[52vh] flex-1 space-y-3 overflow-y-auto p-4">
        {messages === null && !loadErr && <SkeletonCard />}
        {loadErr && <ErrorPanel message={loadErr} onRetry={loadLatest} />}
        {messages !== null && !loadErr && (
          <>
            {nextCursor && (
              <div className="text-center">
                <button
                  type="button"
                  onClick={loadOlder}
                  disabled={olderBusy}
                  className="btn-ghost px-3 py-1.5 text-xs disabled:opacity-60"
                >
                  {olderBusy ? t('messages.loadingOlder') : t('messages.loadOlder')}
                </button>
              </div>
            )}
            {messages.length === 0 && <EmptyState body={t('messages.noMessages')} />}
            {messages.map((m) => {
              const mine = m.senderId === myUserId;
              return (
                <article
                  key={m.id}
                  className={`max-w-[85%] rounded-md border p-3 ${
                    mine
                      ? 'ms-auto border-line/25 bg-console-700/60'
                      : 'me-auto border-line/15 bg-console-800'
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-mist/90">{m.body}</p>
                  <p className="mt-1.5 font-mono text-[10px] uppercase tracking-wider text-haze/80">
                    {mine ? t('messages.you') : label}
                    {' · '}
                    <span dir="ltr">{`${fmtDate(m.createdAt, { day: 'numeric', month: 'short' })} ${fmtTime(m.createdAt)}`}</span>
                    {mine && m.readAt && (
                      <span className="ms-2 text-teal-soft/90 normal-case tracking-normal">
                        {t('messages.readAt', { time: fmtTime(m.readAt) })}
                      </span>
                    )}
                  </p>
                </article>
              );
            })}
            <div ref={endRef} />
          </>
        )}
      </div>

      <div className="hairline-t p-3">
        <label htmlFor="message-composer" className="sr-only">
          {t('messages.composerLabel')}
        </label>
        <textarea
          id="message-composer"
          className="field min-h-[64px] text-sm"
          placeholder={t('messages.composerPlaceholder')}
          value={draft}
          maxLength={MAX_MESSAGE_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-[11px] text-mist/45">{t('messages.composerHint')}</p>
          <button
            type="button"
            onClick={send}
            disabled={sending || !draft.trim()}
            className="btn-primary shrink-0 px-4 py-2 text-sm disabled:opacity-60"
          >
            {sending ? t('messages.sending') : t('messages.send')}
          </button>
        </div>
        {sendErr && <p role="alert" className="mt-2 text-xs text-risk">{sendErr}</p>}
      </div>
    </section>
  );
}
