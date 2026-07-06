'use client';

import type { ReactNode } from 'react';

export interface DataColumn<T> {
  /** Stable column id. */
  id: string;
  /** Already-translated header label. */
  header: string;
  /** Cell renderer — return pre-formatted (fmt*) strings for figures. */
  cell: (row: T) => ReactNode;
  /** Numeric columns: end-aligned, mono, tabular-nums, LTR digits. */
  numeric?: boolean;
  /** Extra classes on both th and td (e.g. hidden sm:table-cell). */
  className?: string;
}

/**
 * Dense hairline data grid — the Command Center's default way to show rows
 * of clinical/finance records. Wide content scrolls inside the wrapper, never
 * the page body. Alignment is logical (start/end) so RTL mirrors correctly,
 * while numeric cells keep LTR digit order.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  className = '',
}: {
  columns: DataColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** Screen-reader table summary (visually hidden). */
  caption?: string;
  /** Already-translated empty text; rendered when rows is empty. */
  empty?: string;
  className?: string;
}) {
  return (
    <div className={`card overflow-x-auto ${className}`}>
      <table className="w-full border-collapse text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="hairline-b">
            {columns.map((c) => (
              <th
                key={c.id}
                scope="col"
                className={`px-3 py-2 font-mono text-[10px] font-medium uppercase tracking-wider text-haze/90 ${
                  c.numeric ? 'text-end' : 'text-start'
                } ${c.className ?? ''}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey(row, i)} className="hairline-b last:border-b-0 transition hover:bg-line/5">
              {columns.map((c) => (
                <td
                  key={c.id}
                  className={`px-3 py-2 align-top ${
                    c.numeric ? 'figure text-end text-mist' : 'text-start text-mist/80'
                  } ${c.className ?? ''}`}
                  dir={c.numeric ? 'ltr' : undefined}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-6 text-center text-xs text-mist/45">
                {empty ?? '—'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
