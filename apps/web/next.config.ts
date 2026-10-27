import path from 'node:path';
import type { NextConfig } from 'next';
import { loadEnv } from '@owm/core/env';

// Next only reads `.env` from the app directory. This is a monorepo with one
// root `.env`, so load it here before any server module reads `process.env`.
loadEnv();

/**
 * Staging is public but not launch-ready, so it stays out of search results
 * unless the image is built with `ALLOW_SEARCH_INDEXING=true`. Next bakes
 * `headers()` into the routes manifest at build time, which is why this is a
 * build argument rather than an ECS environment variable.
 */
function securityHeaders(): { key: string; value: string }[] {
  const indexable = process.env.ALLOW_SEARCH_INDEXING === 'true';
  return [
    // The ALB redirects HTTP to HTTPS and terminates TLS; this keeps browsers
    // from trying the plaintext origin again.
    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Clickjacking: `frame-ancestors` is the modern control, X-Frame-Options
    // covers browsers that ignore it.
    { key: 'X-Frame-Options', value: 'DENY' },
    {
      key: 'Content-Security-Policy',
      // No `script-src` yet: Next needs nonces for its inline bootstrap, so a
      // full policy is a separate change. These directives are enforceable now
      // and do not break anything.
      value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
    },
    { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
    ...(indexable ? [] : [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }]),
  ];
}

const nextConfig: NextConfig = {
  output: 'standalone',
  // Do not advertise the framework and version on every response.
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders() }];
  },
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  serverExternalPackages: ['postgres', 'ioredis', 'bullmq'],
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

export default nextConfig;
