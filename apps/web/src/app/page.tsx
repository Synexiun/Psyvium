'use client';

import Link from 'next/link';
import { SiteNav } from '@/components/SiteNav';
import { LifecycleWave } from '@/components/LifecycleWave';
import { useI18n } from '@/i18n';

const GOV_CHIPS = ['HIPAA', 'GDPR', 'EU AI Act', 'WHO LMM Guidance', 'SOC 2', 'ISO 27001'];

export default function Home() {
  const { t, dict } = useI18n();
  const L = dict.landing;

  return (
    <main className="min-h-screen bg-console-900">
      <a href="#content" className="skip-link">{t('common.skipToContent')}</a>
      <SiteNav />

      {/* ── Hero ── */}
      <section id="content" className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-aurora" />
        <div className="container-vpsy relative py-20 md:py-28">
          <p className="eyebrow animate-rise">{L.heroEyebrow}</p>
          <h1 className="mt-5 max-w-4xl font-display text-4xl font-semibold leading-[1.05] tracking-tight text-mist animate-rise md:text-6xl">
            {L.heroTitleA} <span className="text-teal">{L.heroTitleAccent}</span>.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-mist/60 animate-rise">{L.heroBody}</p>
          <div className="mt-8 flex flex-wrap items-center gap-4 animate-rise">
            <Link href="/intake" className="btn-primary">{L.ctaIntake}</Link>
            <Link href="/manager" className="btn-ghost">{L.ctaCommand}</Link>
          </div>

          <div className="mt-16 card p-6 shadow-console md:p-9">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">{L.waveEyebrow}</span>
              <span className="chip text-teal-soft/80">{t('common.live')}</span>
            </div>
            <LifecycleWave stages={L.stages} />
          </div>
        </div>
      </section>

      {/* ── Category ── */}
      <section id="category" className="border-t border-white/[0.06] py-20">
        <div className="container-vpsy grid gap-10 md:grid-cols-[1fr_1.3fr] md:gap-16">
          <div>
            <p className="eyebrow">{L.categoryEyebrow}</p>
            <h2 className="mt-4 font-display text-3xl font-semibold text-mist">{L.categoryTitle}</h2>
            <p className="mt-5 leading-relaxed text-mist/60">{L.categoryBody}</p>
          </div>
          <div className="card p-7">
            <p className="eyebrow text-signal-soft/80">{L.panelEyebrow}</p>
            <ul className="mt-5 space-y-4">
              {L.questions.map((q, i) => (
                <li key={q} className="flex gap-4">
                  <span className="mt-0.5 font-mono text-xs text-teal">{String(i + 1).padStart(2, '0')}</span>
                  <span className="text-mist/85">{q}</span>
                </li>
              ))}
            </ul>
            <p className="mt-6 border-t border-white/[0.06] pt-5 text-sm text-mist/50">{L.panelFoot}</p>
          </div>
        </div>
      </section>

      {/* ── Six layers ── */}
      <section id="layers" className="border-t border-white/[0.06] py-20">
        <div className="container-vpsy">
          <p className="eyebrow">{L.layersEyebrow}</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold text-mist">{L.layersTitle}</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {L.layers.map((l) => (
              <article key={l.n} className="card group p-6 transition hover:border-teal/30">
                <div className="flex items-center gap-3">
                  <span className="chip text-teal-soft/80">{l.n}</span>
                  <h3 className="font-display text-lg font-medium text-mist">{l.t}</h3>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-mist/60">{l.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Intelligence ── */}
      <section id="intelligence" className="border-t border-white/[0.06] py-20">
        <div className="container-vpsy">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="eyebrow">{L.intelEyebrow}</p>
              <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold text-mist">{L.intelTitle}</h2>
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-mist/55">{L.intelBody}</p>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.06] md:grid-cols-2">
            {L.agents.map((a) => (
              <div key={a.t} className="bg-console-800/70 p-6 transition hover:bg-console-700/60">
                <h3 className="font-display text-base font-medium text-teal-soft">{a.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-mist/60">{a.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Governance ── */}
      <section id="governance" className="border-t border-white/[0.06] py-20">
        <div className="container-vpsy">
          <p className="eyebrow">{L.govEyebrow}</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-semibold text-mist">{L.govTitle}</h2>
          <div className="mt-10 flex flex-wrap gap-3">
            {GOV_CHIPS.map((c) => (
              <span key={c} className="chip border-teal/20 bg-teal/5 text-teal-soft/90">{c}</span>
            ))}
          </div>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {L.govCards.map((g) => (
              <article key={g.t} className="card p-6">
                <h3 className="font-display text-base font-medium text-mist">{g.t}</h3>
                <p className="mt-3 text-sm leading-relaxed text-mist/60">{g.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="border-t border-white/[0.06] py-20">
        <div className="container-vpsy">
          <div className="card relative overflow-hidden p-10 text-center md:p-16">
            <div className="pointer-events-none absolute inset-0 bg-aurora opacity-70" />
            <div className="relative">
              <h2 className="font-display text-3xl font-semibold text-mist md:text-4xl">{L.ctaTitle}</h2>
              <p className="mx-auto mt-4 max-w-xl text-mist/60">{L.ctaBody}</p>
              <div className="mt-8 flex flex-wrap justify-center gap-4">
                <Link href="/intake" className="btn-primary">{L.ctaPrimary}</Link>
                <Link href="/manager" className="btn-ghost">{L.ctaSecondary}</Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/[0.06] py-10">
        <div className="container-vpsy flex flex-col items-center justify-between gap-4 text-sm text-mist/40 md:flex-row">
          <span className="font-mono text-xs tracking-wider">{L.footerTag}</span>
          <span>{t('common.aiMotto')}</span>
        </div>
      </footer>
    </main>
  );
}
