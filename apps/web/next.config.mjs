/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@vpsy/contracts'],
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
