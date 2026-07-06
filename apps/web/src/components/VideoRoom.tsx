'use client';

/**
 * Minimal LiveKit room for Telehealth (context 12) — camera tiles, mic/camera
 * toggles, leave. Built from `livekit-client` + the headless hooks of
 * `@livekit/components-react` with Command Center markup (no prefab styles
 * imported), so it is theme-correct and RTL-safe like every other surface.
 *
 * Loaded with `next/dynamic({ ssr: false })` from the room page — media
 * APIs are browser-only. The join token is short-TTL, room-scoped, and
 * identity-bound (minted server-side; never fabricated here).
 */
import { useEffect, useMemo, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import {
  RoomContext,
  RoomAudioRenderer,
  VideoTrack,
  useLocalParticipant,
  useTracks,
  isTrackReference,
} from '@livekit/components-react';

export interface VideoRoomLabels {
  connecting: string;
  connectFailed: string;
  reconnect: string;
  leave: string;
  mute: string;
  unmute: string;
  cameraOff: string;
  cameraOn: string;
  youTile: string;
  waitingForOther: string;
}

type ConnectPhase = 'connecting' | 'connected' | 'failed';

export default function VideoRoom({
  url,
  token,
  labels,
  onLeave,
}: {
  url: string;
  token: string;
  labels: VideoRoomLabels;
  onLeave: () => void;
}) {
  // One Room per mount — adaptive streaming keeps bandwidth sane on mobile.
  const room = useMemo(() => new Room({ adaptiveStream: true, dynacast: true }), []);
  const [phase, setPhase] = useState<ConnectPhase>('connecting');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setPhase('connecting');
    room
      .connect(url, token)
      .then(async () => {
        if (cancelled) return;
        // Publish after connect; a denied permission still leaves the room
        // usable (receive-only) rather than hard-failing the session.
        try {
          await room.localParticipant.setMicrophoneEnabled(true);
          await room.localParticipant.setCameraEnabled(true);
        } catch {
          /* user denied a device — receive-only is a valid state */
        }
        if (!cancelled) setPhase('connected');
      })
      .catch(() => {
        if (!cancelled) setPhase('failed');
      });
    const onDisconnected = () => {
      if (!cancelled) setPhase('failed');
    };
    room.on(RoomEvent.Disconnected, onDisconnected);
    return () => {
      cancelled = true;
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.disconnect();
    };
    // Reconnect attempts re-run this effect via `attempt`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, url, token, attempt]);

  if (phase === 'failed') {
    return (
      <div className="card-inset p-5 text-center">
        <p className="text-sm text-mist/75">{labels.connectFailed}</p>
        <button type="button" onClick={() => setAttempt((n) => n + 1)} className="btn-ghost mt-3 px-4 py-2 text-sm">
          {labels.reconnect}
        </button>
      </div>
    );
  }

  return (
    <RoomContext.Provider value={room}>
      <div>
        {phase === 'connecting' && (
          <p role="status" className="mb-3 text-sm text-mist/60">
            {labels.connecting}
          </p>
        )}
        <Tiles labels={labels} />
        <RoomAudioRenderer />
        <Controls labels={labels} onLeave={onLeave} />
      </div>
    </RoomContext.Provider>
  );
}

function Tiles({ labels }: { labels: VideoRoomLabels }) {
  // Camera tracks for everyone in the room; placeholders keep a seat visible
  // for a participant whose camera is off.
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], {
    onlySubscribed: false,
  });
  const remoteCount = tracks.filter((t) => !t.participant.isLocal).length;

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {tracks.map((trackRef) => {
          const isLocal = trackRef.participant.isLocal;
          const name = isLocal ? labels.youTile : trackRef.participant.identity;
          const hasVideo = isTrackReference(trackRef) && !trackRef.publication.isMuted;
          return (
            <figure
              key={`${trackRef.participant.identity}-${trackRef.source}`}
              className="relative aspect-video overflow-hidden rounded-md border border-line/25 bg-console-950"
            >
              {hasVideo ? (
                <VideoTrack trackRef={trackRef} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full w-full place-items-center" aria-hidden>
                  <span className="grid h-12 w-12 place-items-center rounded-full border border-line/30 font-mono text-sm uppercase text-mist/60">
                    {name.slice(0, 2)}
                  </span>
                </div>
              )}
              <figcaption className="absolute bottom-0 start-0 m-2 rounded-sm bg-console-950/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-mist/85">
                {name}
              </figcaption>
            </figure>
          );
        })}
      </div>
      {remoteCount === 0 && (
        <p role="status" className="mt-3 text-sm text-mist/60">
          {labels.waitingForOther}
        </p>
      )}
    </div>
  );
}

function Controls({ labels, onLeave }: { labels: VideoRoomLabels; onLeave: () => void }) {
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();

  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        aria-pressed={!isMicrophoneEnabled}
        className="btn-ghost px-3 py-2 text-sm"
      >
        {isMicrophoneEnabled ? labels.mute : labels.unmute}
      </button>
      <button
        type="button"
        onClick={() => localParticipant.setCameraEnabled(!isCameraEnabled)}
        aria-pressed={!isCameraEnabled}
        className="btn-ghost px-3 py-2 text-sm"
      >
        {isCameraEnabled ? labels.cameraOff : labels.cameraOn}
      </button>
      {/* Neutral by design: the risk accent stays reserved for clinical risk,
          so leaving a call is a plain primary action, not a red alarm. */}
      <button type="button" onClick={onLeave} className="btn-primary ms-auto px-4 py-2 text-sm">
        {labels.leave}
      </button>
    </div>
  );
}
