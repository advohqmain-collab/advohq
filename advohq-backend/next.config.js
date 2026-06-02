/** @type {import('next').NextConfig} */
const nextConfig = {
  // API-only mode — no pages needed for the backend service
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@neondatabase/serverless', 'bcryptjs'],
  },
};

module.exports = nextConfig;
