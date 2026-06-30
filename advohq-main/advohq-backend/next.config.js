/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['@neondatabase/serverless', 'bcryptjs'],
  },
};

module.exports = nextConfig;
