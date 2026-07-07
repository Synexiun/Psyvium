'use client';

import Link from 'next/link';
import { useI18n } from '@/i18n';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';

export function SiteNav() {
  const { t } = useI18n();
  const anchors = [
    ['#category', t('nav.category')],
    ['#layers', t('nav.platform')],
    ['#intelligence', t('nav.intelligence')],
    ['#governance', t('nav.governance')],
  ] as const;

  return (
    <header className="hairline-b sticky top-0 z-40 bg-console-900/85 backdrop-blur-md">
      <nav className="container-vpsy flex h-14 items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-sm border border-teal/30 bg-teal/10">
            <span className="h-2 w-2 rounded-full bg-teal animate-pulseline" />
          </span>
          <span className="font-display text-lg font-semibold tracking-tight text-mist">
            VPSY<span className="text-teal"> OS</span>
          </span>
        </Link>
        <div className="hidden items-center gap-8 md:flex">
          {anchors.map(([href, label]) => (
            <a key={href} href={href} className="text-sm text-mist/60 transition hover:text-mist">
              {label}
            </a>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <LanguageSwitcher />
          <Link href="/login" className="hidden text-sm text-mist/70 transition hover:text-mist sm:block">
            {t('common.signIn')}
          </Link>
          <Link href="/intake" className="btn-primary">
            {t('nav.beginIntake')}
          </Link>
        </div>
      </nav>
    </header>
  );
}
