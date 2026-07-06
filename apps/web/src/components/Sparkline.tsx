'use client';

/**
 * Tiny inline sparkline for longitudinal signals (HRV, sleep, outcomes).
 * - Accepts nulls: a gap in the data breaks the line instead of drawing 0.
 * - Isolated points (neighbours are null) render as dots so nothing vanishes.
 * - Always LTR: numeric time series never mirror in RTL locales.
 * - Decorative by design (aria-hidden); the value + trend text next to it is
 *   the accessible representation.
 */
export function Sparkline({
  values,
  className = 'h-7 w-full',
  strokeClass = 'stroke-teal',
  dotClass = 'fill-teal',
}: {
  values: (number | null)[];
  className?: string;
  strokeClass?: string;
  dotClass?: string;
}) {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (nums.length === 0) return <span className="text-xs text-mist/25">—</span>;

  const W = 100;
  const H = 28;
  const PAD = 3;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;

  const pt = (v: number, i: number): [number, number] => [
    PAD + i * step,
    H - PAD - ((v - min) / span) * (H - PAD * 2),
  ];

  const segments: string[] = [];
  const dots: [number, number][] = [];
  let run: [number, number][] = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (run.length === 1) dots.push(run[0]);
      if (run.length > 1) segments.push(run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));
      run = [];
      return;
    }
    run.push(pt(v, i));
  });
  if (run.length === 1) dots.push(run[0]);
  if (run.length > 1) segments.push(run.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '));

  // Emphasize the most recent measurement.
  let last: [number, number] | null = null;
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i];
    if (v !== null && Number.isFinite(v)) {
      last = pt(v, i);
      break;
    }
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={className}
    >
      {segments.map((points, i) => (
        <polyline
          key={i}
          points={points}
          fill="none"
          className={strokeClass}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {dots.map(([x, y], i) => (
        <circle key={`d-${i}`} cx={x} cy={y} r="1.6" className={dotClass} />
      ))}
      {last && <circle cx={last[0]} cy={last[1]} r="2.2" className={dotClass} />}
    </svg>
  );
}
