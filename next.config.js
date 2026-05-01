/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['sharp'],
  api: {
    bodyParser: {
      sizeLimit: '25mb',
    },
  },
  experimental: {
    serverComponentsExternalPackages: ['sharp'],
  },
  images: {
    domains: ['localhost'],
  },
};

module.exports = nextConfig;