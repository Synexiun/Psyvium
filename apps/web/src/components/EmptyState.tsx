'use client';

/**
 * Honest "nothing here yet" — never a fabricated placeholder value.
 * Callers pass already-translated strings.
 */
export function EmptyState({
  eyebrow,
  body,
  className = '',
}: {
  eyebrow?: string;
  body: string;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-dashed border-line/25 bg-console-800/50 p-5 ${className}`}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <p className={`text-sm leading-relaxed text-mist/60 ${eyebrow ? 'mt-2' : ''}`}>{body}</p>
    </div>
  );
}
