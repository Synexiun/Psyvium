import type { CrisisResourceEntry } from '@vpsy/contracts';

/**
 * Jurisdiction-aware emergency crisis-line registry (APA telepsychology
 * guidance §Crisis Management: a telehealth provider must know and be able
 * to hand the client the crisis resource that actually works in the
 * client's location — WAVE CR: "988 is US-only" was hardcoded on the patient
 * home card in a multi-country product).
 *
 * Deliberately a code constant, not a database table or i18n bundle: this is
 * safety-critical, rarely-changing reference data (a handful of national
 * hotlines), and keeping it in version control means every change is
 * reviewed and deployed like code, not silently editable at runtime. A real
 * ops process — a config service, or moving this into an admin-managed
 * table — is the honest long-term home for it as more countries are added;
 * noted here rather than pretended away.
 *
 * Sources (public knowledge, current as of this WAVE CR pass — verify before
 * relying on this for a live crisis; numbers/services do change):
 *  - US: 988 Suicide & Crisis Lifeline (call/text 988, chat 988lifeline.org)
 *  - GB: Samaritans, 116 123, samaritans.org
 *  - CA: 988 Suicide Crisis Helpline (call/text 988)
 *  - AU: Lifeline Australia, 13 11 14
 *  - DE: TelefonSeelsorge, 0800 111 0 111
 *  - FR: 3114 (Numéro national de prévention du suicide)
 *  - ES: 024 (Línea de atención a la conducta suicida)
 *  - Fallback: local emergency services + befrienders.org (international
 *    directory of crisis lines) for jurisdictions not yet in this registry.
 */
export const CRISIS_LINE_FALLBACK: CrisisResourceEntry = {
  countryCode: '*',
  label: 'Local emergency services',
  phone: '112',
  notes:
    'No dedicated crisis line is registered for this country yet — call your local emergency number, or find a local hotline at befrienders.org.',
  chatUrl: 'https://befrienders.org',
};

export const CRISIS_LINE_REGISTRY: Record<string, CrisisResourceEntry> = {
  US: {
    countryCode: 'US',
    label: '988 Suicide & Crisis Lifeline',
    phone: '988',
    smsNumber: '988',
    chatUrl: 'https://988lifeline.org/chat',
  },
  GB: {
    countryCode: 'GB',
    label: 'Samaritans',
    phone: '116 123',
    chatUrl: 'https://www.samaritans.org',
    notes: 'Free, available 24/7 from any UK phone.',
  },
  CA: {
    countryCode: 'CA',
    label: '988 Suicide Crisis Helpline',
    phone: '988',
    smsNumber: '988',
  },
  AU: {
    countryCode: 'AU',
    label: 'Lifeline Australia',
    phone: '13 11 14',
    chatUrl: 'https://www.lifeline.org.au',
  },
  DE: {
    countryCode: 'DE',
    label: 'TelefonSeelsorge',
    phone: '0800 111 0 111',
    chatUrl: 'https://www.telefonseelsorge.de',
    notes: 'Free and anonymous, available 24/7.',
  },
  FR: {
    countryCode: 'FR',
    label: 'Numéro national de prévention du suicide',
    phone: '3114',
    notes: 'Free, available 24/7 from any French phone.',
  },
  ES: {
    countryCode: 'ES',
    label: 'Línea 024 de atención a la conducta suicida',
    phone: '024',
    notes: 'Free, available 24/7 from any Spanish phone.',
  },
};

/**
 * Resolves a country's crisis-line entry, honestly falling back to the
 * generic entry (never a wrong/dead number) when the country isn't
 * registered yet.
 */
export function resolveCrisisResource(countryCode: string | null | undefined): {
  resolved: CrisisResourceEntry;
  isFallback: boolean;
} {
  const normalized = countryCode?.toUpperCase().trim();
  const entry = normalized ? CRISIS_LINE_REGISTRY[normalized] : undefined;
  if (entry) return { resolved: entry, isFallback: false };
  return { resolved: CRISIS_LINE_FALLBACK, isFallback: true };
}
