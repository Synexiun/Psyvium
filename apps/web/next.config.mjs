import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vpsy/contracts'],
  // Wave D (docs/technical/10-observability-and-devops.md §5): the Docker
  // image (apps/web/Dockerfile) runs the standalone server output, which
  // needs its own minimal node_modules traced+copied in rather than the
  // dev `next start` + full node_modules used locally/on Vercel.
  output: 'standalone',
  // In this pnpm/turborepo monorepo, Next's file tracer must be told the
  // workspace root explicitly — otherwise, with the app nested under
  // apps/web, it can mis-detect the root (e.g. from a package manager
  // lockfile higher up) and omit files the standalone build needs, notably
  // the workspace dependency @vpsy/contracts.
  outputFileTracingRoot: path.join(__dirname, '../../'),
  async rewrites() {
    // Render `fromService.property: host` returns a bare hostname. Normalize
    // so rewrites always hit an absolute URL with a scheme.
    const rawApi =
      process.env.API_URL ??
      (process.env.NODE_ENV === 'production'
        ? 'https://psyvium-api.onrender.com'
        : 'http://localhost:4000');
    const apiBase =
      rawApi.startsWith('http://') || rawApi.startsWith('https://')
        ? rawApi
        : `https://${rawApi}`;

    return [
      {
        source: '/api/backend/:path*',
        destination: `${apiBase}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
