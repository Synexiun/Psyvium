'use client';

/**
 * Clinical/finance figure tile. The VALUE is always mono + tabular-nums so
 * columns of tiles align digit-for-digit and scan fast. Numbers are rendered
 * LTR even in RTL locales (figures never mirror).
 */
export function StatTile({
  label,
  value,
  unit,
  hint,
  className = '',
}: {
  label: string;
  /** Pre-formatted (fmtNumber/fmtPercent) value, or '—' when absent. */
  value: string;
  unit?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div className={`card-inset p-3 ${className}`}>
      <p className="font-mono text-[10px] uppercase tracking-wider text-haze/90">{label}</p>
      <p className="figure mt-1.5 text-2xl font-medium leading-none text-mist" dir="ltr">
        {value}
        {unit && <span className="ms-1 font-sans text-xs font-normal text-haze">{unit}</span>}
      </p>
      {hint && <p className="mt-1.5 text-[11px] leading-snug text-mist/50">{hint}</p>}
    </div>
  );
}
