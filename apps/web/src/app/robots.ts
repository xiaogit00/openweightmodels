import type { MetadataRoute } from 'next';

/**
 * Staging and previews must never be indexed. A public launch builds the image
 * with `ALLOW_SEARCH_INDEXING=true`; `next.config.ts` adds an `X-Robots-Tag`
 * header under the same flag.
 */
export default function robots(): MetadataRoute.Robots {
  const indexable = process.env.ALLOW_SEARCH_INDEXING === 'true';
  return indexable
    ? { rules: { userAgent: '*', allow: '/' } }
    : { rules: { userAgent: '*', disallow: '/' } };
}
