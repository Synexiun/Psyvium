'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { useI18n } from '@/i18n';
import type { CommsLogEntryDto, MediaMessageDto, MediaKind } from '@/lib/comms-types';

export default function CommsPage() {
  const { t } = useI18n();
  const [log, setLog] = useState<CommsLogEntryDto[]>([]);
  const [live, setLive] = useState<'live' | 'offline' | 'loading'>('loading');

  async function loadLog() {
    try {
      setLog(await api.commsLog());
      setLive('live');
    } catch {
      setLive('offline');
      setLog((prev) => (prev.length ? prev : []));
    }
  }

  useEffect(() => {
    void loadLog();
  }, []);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="eyebrow">{t('comms.eyebrow')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold text-mist">{t('comms.title')}</h1>
        </div>
        <span role="status" className={`chip ${live === 'live' ? 'text-teal-soft/80' : live === 'offline' ? 'chip-signal' : 'text-mist/50'}`}>
          {live === 'live' ? t('common.liveData') : live === 'offline' ? t('common.connectionIssue') : t('common.loadingLive')}
        </span>
      </div>
      <p className="mt-3 max-w-3xl text-mist/60">{t('comms.intro')}</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <TelephonyPanel onChanged={loadLog} />
        <LiveCallPanel />
        <MediaMessagesPanel />
        <CommsLogPanel log={log} />
      </div>
    </div>
  );
}

/* ── Telephony & SMS ─────────────────────────────────────────────────── */
function TelephonyPanel({ onChanged }: { onChanged: () => void }) {
  const { t } = useI18n();
  const [to, setTo] = useState('+15551234567');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState<'call' | 'sms' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  async function call() {
    setBusy('call'); setMsg(null);
    try { await api.commsClickToCall({ toE164: to }); setMsg({ text: t('comms.callLogged'), ok: true }); onChanged(); }
    catch { setMsg({ text: t('comms.callFailed'), ok: false }); }
    finally { setBusy(null); }
  }
  async function sms() {
    if (!body.trim()) return;
    setBusy('sms'); setMsg(null);
    try { await api.commsSendSms({ toE164: to, body: body.trim() }); setBody(''); setMsg({ text: t('comms.smsSent'), ok: true }); onChanged(); }
    catch { setMsg({ text: t('comms.smsFailed'), ok: false }); }
    finally { setBusy(null); }
  }

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('comms.telephonyEyebrow')}</p>
      <label className="field-label mt-4">{t('comms.toNumber')}</label>
      <input className="field" dir="ltr" value={to} onChange={(e) => setTo(e.target.value)} placeholder={t('comms.numberPlaceholder')} />
      <button onClick={call} disabled={busy !== null} className="btn-ghost mt-3 w-full disabled:opacity-60">
        {busy === 'call' ? t('comms.calling') : t('comms.callNow')}
      </button>
      <label className="field-label mt-5">{t('comms.smsBody')}</label>
      <textarea className="field min-h-[72px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder={t('comms.smsPlaceholder')} />
      <button onClick={sms} disabled={busy !== null || !body.trim()} className="btn-primary mt-3 w-full disabled:opacity-60">
        {busy === 'sms' ? t('comms.sending') : t('comms.sendSms')}
      </button>
      {msg && <p role="status" className={`mt-3 text-sm ${msg.ok ? 'text-teal-soft' : 'text-risk'}`}>{msg.text}</p>}
    </section>
  );
}

/* ── Async voice/video messages ──────────────────────────────────────── */
function MediaMessagesPanel() {
  const { t } = useI18n();
  const [threadId, setThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MediaMessageDto[]>([]);
  const [recording, setRecording] = useState<MediaKind | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);

  async function resolveThread(): Promise<string | null> {
    try {
      const threads = await api.msgThreads();
      const first = threads[0]?.id ?? null;
      setThreadId(first);
      return first;
    } catch {
      setThreadId(null);
      return null;
    }
  }

  async function loadThread() {
    const id = threadId ?? (await resolveThread());
    if (!id) {
      setMessages([]);
      setNote(t('comms.noMediaThread'));
      return;
    }
    try {
      setMessages(await api.commsThreadMedia(id));
      setNote(null);
    } catch {
      /* offline */
    }
  }
  useEffect(() => {
    void loadThread();
  }, []);

  function cleanup() {
    if (timerRef.current) clearInterval(timerRef.current);
    streamRef.current?.getTracks().forEach((tk) => tk.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }

  async function start(kind: MediaKind) {
    setNote(null);
    const id = threadId ?? (await resolveThread());
    if (!id) {
      setNote(t('comms.noMediaThread'));
      return;
    }
    if (typeof window === 'undefined' || !navigator.mediaDevices || typeof MediaRecorder === 'undefined') {
      setNote(t('comms.unsupported')); return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(kind === 'VIDEO' ? { audio: true, video: true } : { audio: true });
      streamRef.current = stream;
      if (kind === 'VIDEO' && previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.start();
      recorderRef.current = rec;
      setRecording(kind);
      setSeconds(0);
      timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
    } catch {
      setNote(t('comms.micDenied'));
      cleanup();
    }
  }

  async function stopAndSend() {
    const rec = recorderRef.current;
    const kind = recording;
    if (!rec || !kind) return;
    const dur = seconds;
    setRecording(null);
    if (timerRef.current) clearInterval(timerRef.current);

    const blob: Blob = await new Promise((resolve) => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || (kind === 'VIDEO' ? 'video/webm' : 'audio/webm') }));
      rec.stop();
    });
    cleanup();

    setSending(true);
    setNote(null);
    try {
      const id = threadId ?? (await resolveThread());
      if (!id) {
        setNote(t('comms.noMediaThread'));
        return;
      }
      const dataUrl: string = await new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error('read'));
        fr.readAsDataURL(blob);
      });
      // Media binary storage remains activate-on-config; storageKey is still an
      // opaque key. Data URIs are accepted only for local demos — production
      // should post an object-storage key after a real upload pipeline.
      await api.commsCreateMediaMessage({
        threadId: id,
        kind,
        storageKey: dataUrl,
        durationSec: dur,
        mimeType: blob.type,
      });
      setNote(t('comms.mediaSent'));
      await loadThread();
    } catch {
      setNote(t('comms.mediaFailed'));
    } finally {
      setSending(false);
    }
  }

  function discard() {
    setRecording(null);
    cleanup();
  }

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('comms.mediaEyebrow')}</p>
      <p className="mt-2 text-xs text-mist/50">{t('comms.mediaIntro')}</p>

      {recording === 'VIDEO' && (
        <video ref={previewRef} muted playsInline dir="ltr" className="mt-3 aspect-video w-full rounded bg-console-950 object-cover" />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!recording ? (
          <>
            <button onClick={() => start('VOICE')} disabled={sending} className="btn-ghost px-4 py-2 text-sm disabled:opacity-60">{t('comms.recordVoice')}</button>
            <button onClick={() => start('VIDEO')} disabled={sending} className="btn-ghost px-4 py-2 text-sm disabled:opacity-60">{t('comms.recordVideo')}</button>
          </>
        ) : (
          <>
            <span className="chip chip-signal figure">{t('comms.recording', { sec: seconds })}</span>
            <button onClick={stopAndSend} className="btn-primary px-4 py-2 text-sm">{t('comms.stopSend')}</button>
            <button onClick={discard} className="btn-ghost px-4 py-2 text-sm">{t('comms.discard')}</button>
          </>
        )}
      </div>
      {sending && <p className="mt-2 text-sm text-mist/50">{t('comms.sendingMedia')}</p>}
      {note && <p role="status" className="mt-2 text-sm text-mist/60">{note}</p>}

      <ul className="mt-4 space-y-3">
        {messages.length === 0 && <li className="text-xs text-mist/30">{t('comms.mediaEmpty')}</li>}
        {messages.map((m) => (
          <li key={m.id} className="card-inset p-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-teal-soft/70 tabular-nums">
              {m.kind === 'VIDEO' ? t('comms.videoMsg') : t('comms.voiceMsg')} · {m.durationSec}s
            </p>
            {m.kind === 'VIDEO' ? (
              <video controls playsInline dir="ltr" src={m.storageKey} className="mt-2 aspect-video w-full rounded-sm bg-console-950" />
            ) : (
              <audio controls src={m.storageKey} className="mt-2 w-full" />
            )}
            {m.transcript && <p className="mt-1.5 text-xs text-mist/55">{m.transcript}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ── In-house live call (local media + SFU handshake) ────────────────── */
function LiveCallPanel() {
  const { t } = useI18n();
  const [inCall, setInCall] = useState(false);
  const [room, setRoom] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  async function start(video: boolean) {
    setNote(null);
    if (typeof window === 'undefined' || !navigator.mediaDevices) { setNote(t('comms.unsupported')); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video });
      streamRef.current = stream;
      if (video && videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setInCall(true);
      try {
        const tok = await api.commsRtcToken();
        setRoom(tok.roomId);
      } catch {
        setRoom('offline-demo-room');
      }
    } catch {
      setNote(t('comms.micDenied'));
    }
  }

  function end() {
    streamRef.current?.getTracks().forEach((tk) => tk.stop());
    streamRef.current = null;
    setInCall(false);
    setRoom(null);
  }

  return (
    <section className="card p-5">
      <p className="eyebrow">{t('comms.liveEyebrow')}</p>
      <h2 className="mt-2 font-display text-lg font-medium text-mist">{t('comms.liveTitle')}</h2>
      <p className="mt-1 text-xs text-mist/50">{t('comms.liveIntro')}</p>

      <div className="mt-3 aspect-video w-full overflow-hidden rounded bg-console-950">
        <video ref={videoRef} muted playsInline dir="ltr" className="h-full w-full object-cover" />
      </div>
      {inCall && (
        <>
          <p className="mt-2 font-mono text-[11px] uppercase tracking-wider text-teal-soft/70">{t('comms.roomReady', { room: room ?? '…' })}</p>
          <p className="mt-1 text-xs text-mist/45">{t('comms.sfuNote')}</p>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!inCall ? (
          <>
            <button onClick={() => start(true)} className="btn-primary px-4 py-2 text-sm">{t('comms.startVideo')}</button>
            <button onClick={() => start(false)} className="btn-ghost px-4 py-2 text-sm">{t('comms.startVoice')}</button>
          </>
        ) : (
          <button onClick={end} className="btn-ghost border-risk/40 px-4 py-2 text-sm text-risk">{t('comms.endCall')}</button>
        )}
      </div>
      {note && <p role="status" className="mt-2 text-sm text-signal-soft">{note}</p>}
    </section>
  );
}

/* ── Unified comms log ───────────────────────────────────────────────── */
function CommsLogPanel({ log }: { log: CommsLogEntryDto[] }) {
  const { t, dict, fmtDate } = useI18n();
  return (
    <section className="card p-5">
      <p className="eyebrow">{t('comms.logEyebrow')}</p>
      <ul className="mt-4 space-y-2">
        {log.length === 0 && <li className="text-xs text-mist/30">{t('comms.logEmpty')}</li>}
        {log.map((e) => (
          <li key={e.id} className="card-inset flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-mist/85">{e.summary}</p>
              <p className="font-mono text-[10px] uppercase tracking-wider text-mist/40">
                {dict.comms.kinds[e.kind]} · {dict.comms.dir[e.direction]}
              </p>
            </div>
            <span className="shrink-0 text-xs text-mist/40">{fmtDate(e.occurredAt)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
