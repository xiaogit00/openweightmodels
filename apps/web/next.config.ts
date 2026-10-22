import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  serverExternalPackages: ['postgres', 'ioredis', 'bullmq'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
