'use client';

/**
 * Loading placeholders — the shared "still connecting" state.
 * Purely decorative (aria-hidden); pages announce loading via their own
 * role="status" line, so screen readers hear one message, not many bars.
 */
export function Skeleton({ className = 'h-3 w-32' }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-sm bg-console-600/60 ${className}`} />;
}

/** A card-shaped skeleton block: eyebrow + heading + support line. */
export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div aria-hidden className={`card animate-pulse p-5 ${className}`}>
      <Skeleton className="h-2.5 w-24" />
      <Skeleton className="mt-4 h-4 w-52" />
      <Skeleton className="mt-3 h-2.5 w-36" />
    </div>
  );
}

/** A stack of n skeleton cards — the default whole-page loading state. */
export function SkeletonStack({ count = 3, className = 'space-y-4' }: { count?: number; className?: string }) {
  return (
    <div aria-hidden className={className}>
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}
