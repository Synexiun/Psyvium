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
    return [
      {
        source: '/api/backend/:path*',
        // API_URL wins when set; production builds otherwise default to the
        // live API (a localhost fallback in prod becomes Vercel's
        // DNS_HOSTNAME_RESOLVED_PRIVATE 404 — observed on the first deploy);
        // dev keeps localhost.
        destination: `${process.env.API_URL ?? (process.env.NODE_ENV === 'production' ? 'https://psyvium-api.onrender.com' : 'http://localhost:4000')}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
