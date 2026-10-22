import path from 'node:path';
import type { NextConfig } from 'next';
import { loadEnv } from '@owm/core/env';

// Next only reads `.env` from the app directory. This is a monorepo with one
// root `.env`, so load it here before any server module reads `process.env`.
loadEnv();

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
