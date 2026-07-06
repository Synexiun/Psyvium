/**
 * Signature element: the care lifecycle rendered as a living vital-signs
 * waveform. Each labelled node is a stage of the psychological care lifecycle —
 * the platform's whole thesis is that it tracks care as one continuous signal,
 * intake → national analytics, rather than a folder of disconnected records.
 *
 * The signal always reads left→right (time), even in RTL locales — like an
 * ECG trace, it is a chart, not prose. Stage labels are passed in localized.
 */
const DEFAULT_STAGES = [
  'Intake',
  'Screening',
  'Triage',
  'Assignment',
  'Assessment',
  'Formulation',
  'Treatment',
  'Intervention',
  'Outcomes',
  'Analytics',
];

// A calm-then-alert cardiac-style path across 1000x160.
const PATH =
  'M0,110 L120,110 L150,110 L165,60 L180,150 L200,110 L320,110 L345,110 L360,40 L378,160 L398,110 L520,110 ' +
  'L545,110 L560,70 L576,148 L596,110 L720,110 L745,110 L760,30 L780,165 L800,110 L1000,110';

export function LifecycleWave({ className = '', stages = DEFAULT_STAGES }: { className?: string; stages?: string[] }) {
  return (
    <div className={`relative ${className}`} dir="ltr" aria-hidden>
      <svg viewBox="0 0 1000 200" className="w-full" role="img">
        <defs>
          <linearGradient id="wave" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#1B7E88" />
            <stop offset="55%" stopColor="#38BDC9" />
            <stop offset="100%" stopColor="#7CD9E1" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="3.2" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <path d={PATH} fill="none" stroke="url(#wave)" strokeWidth="2.5" strokeLinejoin="round" filter="url(#glow)" />
        {stages.map((_, i) => {
          const x = 20 + i * (960 / (stages.length - 1));
          return (
            <circle
              key={i}
              cx={x}
              cy={110}
              r={3.5}
              fill="#7CD9E1"
              className="animate-pulseline"
              style={{ animationDelay: `${i * 0.25}s` }}
            />
          );
        })}
      </svg>
      <div className="mt-3 hidden justify-between gap-1 px-1 md:flex">
        {stages.map((s, i) => (
          <span
            key={s}
            className="font-mono text-[10px] uppercase tracking-[0.12em] text-mist/40"
            style={{ opacity: i === 2 || i === 8 ? 0.85 : 0.4 }}
          >
            {s}
          </span>
        ))}
      </div>
    </div>
  );
}
