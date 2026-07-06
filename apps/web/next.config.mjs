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
        destination: `${process.env.API_URL ?? 'http://localhost:4000'}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
