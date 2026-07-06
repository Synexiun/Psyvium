'use client';

/**
 * Right context-panel slot. The portal shell owns an <aside> host element;
 * pages render <ContextPanel>…</ContextPanel> anywhere in their tree and the
 * content is portaled into the slot — no state loops, SSR-safe (renders
 * nothing until the host mounts). On wide screens (xl) the panel is a fixed
 * end-side column; below that the shell stacks it after the main column so
 * nothing is ever hidden on mobile.
 */
import { createContext, useContext } from 'react';
import { createPortal } from 'react-dom';

const ContextPanelHost = createContext<HTMLElement | null>(null);

export const ContextPanelHostProvider = ContextPanelHost.Provider;

export function ContextPanel({ children }: { children: React.ReactNode }) {
  const host = useContext(ContextPanelHost);
  if (!host) return null;
  return createPortal(children, host);
}
