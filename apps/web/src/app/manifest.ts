import type { MetadataRoute } from 'next';

/**
 * Dynamic PWA manifest (docs/technical/11-frontend-architecture.md §5:
 * "Installability | `app/manifest.ts`"). Next serves this at
 * `/manifest.webmanifest` and injects the `<link rel="manifest">` tag
 * automatically — replaces the old static `public/manifest.webmanifest`.
 *
 * Colors match the Command Center dark shell (bg-console-900 / the existing
 * app icon background) so the OS splash/install surface never looks like a
 * different product than the app itself.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'VPSY OS — Clinical Psychology Operating System',
    short_name: 'VPSY OS',
    description: 'Behavioral-health operating system. AI assists, licensed clinicians decide.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#0B1020',
    theme_color: '#0B1020',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
    shortcuts: [
      {
        name: 'Intake',
        short_name: 'Intake',
        description: 'Start a new client intake',
        url: '/intake',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
      {
        name: 'Session workspace',
        short_name: 'Session',
        description: 'Open the clinician session workspace',
        url: '/session',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
      },
    ],
  };
}
