/** @type {import('next').NextConfig} */
const nextConfig = {
  // API-only mode — no pages needed for the backend service
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['pg', 'bcryptjs'],
  },
};

module.exports = nextConfig;
