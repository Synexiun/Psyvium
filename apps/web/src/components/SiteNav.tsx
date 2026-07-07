'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function SiteNav() {
  const { t } = useI18n();
  const anchors = [
    ['/#platform', 'Platform'],
    ['/#lifecycle', 'Lifecycle'],
    ['/#roles', 'Roles'],
    ['/#his', 'HIS'],
    ['/compliance', 'Compliance'],
  ] as const;

  return (
    <header className="sticky top-0 z-40 border-b border-[#d9e0ea] bg-white/92 backdrop-blur-md">
      <nav className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-4 px-6">
        <Link
          href="/"
          className="flex items-center gap-3"
          aria-label="Psyvium OS home"
        >
          <span
            className="grid h-8 w-8 place-items-center rounded border border-[#cfd8e3] bg-[#f8fafc]"
            aria-hidden
          >
            <span className="h-2.5 w-2.5 rounded-sm bg-[#3e5068]" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-[#111827]">
            Psyvium<span className="text-[#3e5068]"> OS</span>
          </span>
        </Link>
        <div className="hidden items-center gap-7 lg:flex">
          {anchors.map(([href, label]) => (
            <a
              key={href}
              href={href}
              className="text-sm font-medium text-[#667085] transition hover:text-[#111827]"
            >
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <LanguageSwitcher tone="light" />
          </div>
          <Link
            href="/login"
            className="hidden text-sm font-semibold text-[#475467] transition hover:text-[#111827] md:block"
          >
            {t('common.signIn')}
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded bg-[#111827] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#2d3748] sm:px-4"
          >
            Demo
          </Link>
        </div>
      </nav>
    </header>
  );
}
