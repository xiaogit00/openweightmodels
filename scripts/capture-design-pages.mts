/**
 * Captures the current production UI as standalone static HTML files for
 * design review. It drives the running dev server with a seeded database,
 * snapshots the rendered DOM, inlines the stylesheets and self-hosts the
 * fonts, then strips every script so each file opens directly from disk.
 *
 * Usage (with the web app already running on :3000):
 *   pnpm exec tsx scripts/capture-design-pages.mts
 */
import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const BASE = process.env.CAPTURE_BASE_URL ?? 'http://localhost:3000';
const OUT = path.resolve('design_handoff_current');
const SCREENSHOTS = path.join(OUT, 'screenshots');
const FONT_DIR = path.join(OUT, 'assets', 'fonts');

const VIEWPORT = { width: 1440, height: 900 };

/** Read `--flag value` from the command line. */
function arg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index > -1 ? process.argv[index + 1] : undefined;
}

/** Same-origin destinations that exist in the static bundle. */
const PAGE_LINKS: Array<[RegExp, string]> = [
  [/^\/$/, 'board.html'],
  [/^\/new$/, 'new-comparison.html'],
  [/^\/comparisons\/[^/?#]+$/, 'comparison.html'],
];

async function prepareOutput() {
  await mkdir(SCREENSHOTS, { recursive: true });
  await mkdir(FONT_DIR, { recursive: true });
}

/**
 * Replace internal links with the corresponding static file (or `#` when the
 * page was not captured) so the bundle has no dead routes.
 */
async function rewriteLinks(page: Page) {
  await page.evaluate((rules) => {
    const mapped = rules.map(([source, target]) => [new RegExp(source), target] as const);
    for (const anchor of Array.from(document.querySelectorAll('a[href]'))) {
      const href = anchor.getAttribute('href') ?? '';
      if (!href.startsWith('/') || href.startsWith('//')) continue;
      const match = mapped.find(([pattern]) => pattern.test(href));
      anchor.setAttribute('href', match ? match[1] : '#');
      if (!match) anchor.setAttribute('title', `Not included in the static preview (${href})`);
    }
  }, PAGE_LINKS.map(([pattern, target]) => [pattern.source, target]));
}

/** Drop the dev overlay, scripts and Next internals before serialising. */
async function cleanDom(page: Page) {
  await page.evaluate(() => {
    // Browser serialisation does not reflect live *properties* of form
    // controls, so persist what React rendered into attributes first.
    for (const select of Array.from(document.querySelectorAll('select'))) {
      for (const option of Array.from(select.options)) {
        if (option.value === select.value) option.setAttribute('selected', '');
        else option.removeAttribute('selected');
      }
    }
    for (const textarea of Array.from(document.querySelectorAll('textarea'))) {
      textarea.textContent = textarea.value;
    }
    for (const input of Array.from(document.querySelectorAll('input'))) {
      input.setAttribute('value', input.value);
      if (input.checked) input.setAttribute('checked', '');
      else input.removeAttribute('checked');
    }

    for (const selector of [
      'script',
      'link[rel="stylesheet"]',
      'link[rel="preload"]',
      'link[rel="modulepreload"]',
      'nextjs-portal',
      '[data-next-badge-root]',
      'next-route-announcer',
      'style',
    ]) {
      document.querySelectorAll(selector).forEach((element) => element.remove());
    }
    document.querySelectorAll('[data-nextjs-toast]').forEach((el) => el.remove());
  });
}

/**
 * Concatenate every stylesheet the page loaded. Reading `cssRules` keeps the
 * cascade and @layer order that the bundled CSS shipped with.
 */
async function collectCss(page: Page): Promise<string> {
  return page.evaluate(() => {
    const chunks: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        const rules = Array.from(sheet.cssRules).map((rule) => rule.cssText);
        let css = rules.join('\n');
        // CSSOM keeps `url()` relative to the stylesheet, so resolve it now
        // before the rules are lifted out of their original file.
        if (sheet.href) {
          css = css.replace(
            /url\(\s*(['"]?)([^'")]+)\1\s*\)/g,
            (whole: string, quote: string, url: string) => {
              if (!url || url.startsWith('data:') || url.startsWith('#')) return whole;
              try {
                return `url("${new URL(url, sheet.href!).href}")`;
              } catch {
                return whole;
              }
            },
          );
        }
        chunks.push(css);
      } catch {
        // Cross-origin or opaque sheet: nothing we can inline.
      }
    }
    return chunks.join('\n\n');
  });
}

type Asset = { url: string; file: string };

/** Download every `url(...)` the CSS references and return the rewrite map. */
async function localiseCssAssets(
  context: BrowserContext,
  css: string,
): Promise<{ css: string; assets: Asset[] }> {
  const urls = new Set<string>();
  const urlPattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(css))) {
    const url = match[2]!.trim();
    if (!url || url.startsWith('data:') || url.startsWith('#')) continue;
    if (!url.startsWith('/') && !url.startsWith(BASE)) {
      console.warn(`[capture] unresolved relative asset url: ${url}`);
      continue;
    }
    urls.add(url);
  }

  const assets: Asset[] = [];
  for (const url of urls) {
    const absolute = url.startsWith('http') ? url : `${BASE}${url}`;
    const response = await context.request.get(absolute);
    if (!response.ok()) {
      console.warn(`[capture] could not fetch ${absolute} (${response.status()})`);
      continue;
    }
    const file = `assets/fonts/${path.basename(new URL(absolute).pathname)}`;
    await writeFile(path.join(OUT, file), await response.body());
    assets.push({ url, file });
  }

  let rewritten = css;
  for (const asset of assets) {
    rewritten = rewritten.split(asset.url).join(asset.file);
  }
  return { css: rewritten, assets };
}

async function capture(
  context: BrowserContext,
  name: string,
  url: string,
  options: {
    waitFor?: (page: Page) => Promise<unknown>;
    prepare?: (page: Page) => Promise<void>;
  } = {},
) {
  const page = await context.newPage();
  await page.setViewportSize(VIEWPORT);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  if (options.waitFor) await options.waitFor(page);
  await page.evaluate(() => document.fonts.ready);
  if (options.prepare) await options.prepare(page);
  await page.waitForTimeout(700);

  await rewriteLinks(page);
  const css = await collectCss(page);
  const { css: inlinedCss, assets } = await localiseCssAssets(context, css);
  await cleanDom(page);

  let html = await page.content();
  html = html.replace('</head>', `<style>\n${inlinedCss}\n</style>\n</head>`);
  html = html.replace(
    '</body>',
    `<!-- Static snapshot captured ${new Date().toISOString()} from ${BASE}${url}. Scripts were removed; controls are inert. -->\n</body>`,
  );
  const file = path.join(OUT, name);
  await writeFile(file, html);

  // Screenshot the finished standalone file, not the dev page: this both
  // proves the bundle renders without its scripts and leaves the Next dev
  // indicator out of the image.
  const snapshot = await context.newPage();
  await snapshot.setViewportSize(VIEWPORT);
  await snapshot.goto(`file://${file}`);
  await snapshot.evaluate(() => document.fonts.ready);
  await snapshot.evaluate(() => window.scrollTo(0, 0));
  await snapshot.waitForTimeout(1000);
  await snapshot.screenshot({
    path: path.join(SCREENSHOTS, name.replace(/\.html$/, '.png')),
    fullPage: true,
  });
  await snapshot.close();

  const leftover = html.match(/\/_next\/static\/[^"') ]+/g);
  if (leftover) {
    console.warn(`[capture] ${name} still references ${leftover.length} _next asset(s)`);
  }
  console.log(
    `[capture] ${name}: ${(html.length / 1024).toFixed(0)} KB html, ${assets.length} font files`,
  );
  await page.close();
}

/** Fill the new-comparison form with a realistic single-output upload. */
async function fillNewComparison(page: Page) {
  const sample = [
    '---',
    'prompt: Write a thread-safe sliding-window rate limiter in Go.',
    'model: Llama 3.3 70B',
    '---',
    '',
    "Here's a sliding-window rate limiter that tracks request timestamps per key.",
    "It's safe for concurrent use and evicts old entries lazily on each call.",
    '',
    '```go',
    'type Limiter struct {',
    '    mu     sync.Mutex',
    '    window time.Duration',
    '    limit  int',
    '    hits   map[string][]time.Time',
    '}',
    '',
    'func (l *Limiter) Allow(key string) bool {',
    '    l.mu.Lock()',
    '    defer l.mu.Unlock()',
    '    now := time.Now()',
    '    hits := l.hits[key]',
    '    cut := 0',
    '    for cut < len(hits) && now.Sub(hits[cut]) > l.window {',
    '        cut++',
    '    }',
    '    hits = hits[cut:]',
    '    if len(hits) >= l.limit {',
    '        return false',
    '    }',
    '    l.hits[key] = append(hits, now)',
    '    return true',
    '}',
    '```',
    '',
    'Memory grows with the number of distinct keys, so pair it with a periodic sweep or a bounded map.',
  ].join('\n');

  await page.locator('input[type="file"]').setInputFiles({
    name: 'rate-limiter-go.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from(sample),
  });

  // Wait for the import to finish and the front-matter model to be selected
  // before touching the challenger tiles, otherwise the clicks race the parse.
  await page.getByRole('button', { name: 'Replace' }).waitFor();
  await page.waitForFunction(() => {
    const select = document.querySelector('select');
    return Boolean(select && select.value);
  });

  await page.getByRole('button', { name: /Qwen3\.8 27B/ }).click();
  await page.getByRole('button', { name: /DeepSeek V4\.1 Flash 1017/ }).click();
  await page.getByRole('button', { name: /Mistral Large 4/ }).click();
  await page.getByRole('button', { name: 'Coding', exact: true }).click();
  await page.getByRole('button', { name: /High/ }).click();
}

async function main() {
  await prepareOutput();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const handle = arg('--handle') ?? 'mira';
  await context.request.post(`${BASE}/api/dev/user`, { data: { handle } });

  // Targeted single-page capture, used for screens outside the seeded bundle:
  //   pnpm exec tsx scripts/capture-design-pages.mts \
  //     --comparison <id> --handle lei --name comparison-turns.html
  const onlyComparison = arg('--comparison');
  if (onlyComparison) {
    await capture(
      context,
      arg('--name') ?? 'comparison-turns.html',
      `/comparisons/${onlyComparison}`,
      { waitFor: (page) => page.locator('main h1').waitFor() },
    );
    await browser.close();
    return;
  }

  // Resolve the seeded annotated comparison so links and captures target it.
  const comparisonResponse = await context.request.get(
    `${BASE}/api/comparisons?q=${encodeURIComponent('Rate limiter in Go')}`,
  );
  const comparisonPayload = (await comparisonResponse.json()) as {
    items: Array<{ id: string; title: string }>;
  };
  const comparison = comparisonPayload.items.find(
    (item) => item.title === 'Rate limiter in Go with sliding windows',
  );

  await capture(context, 'board.html', '/', {
    waitFor: (page) => page.locator('main a.card').first().waitFor(),
  });

  await capture(context, 'new-comparison-empty.html', '/new', {
    waitFor: (page) => page.getByRole('heading', { name: 'New comparison' }).waitFor(),
  });

  await capture(context, 'new-comparison.html', '/new', {
    waitFor: (page) => page.getByRole('heading', { name: 'New comparison' }).waitFor(),
    prepare: fillNewComparison,
  });

  if (comparison) {
    await capture(context, 'comparison.html', `/comparisons/${comparison.id}`, {
      waitFor: (page) => page.getByRole('heading', { name: comparison.title }).waitFor(),
    });
    await capture(
      context,
      'comparison-annotated.html',
      `/comparisons/${comparison.id}?annotations=1`,
      {
        waitFor: (page) => page.getByRole('heading', { name: comparison.title }).waitFor(),
      },
    );
  } else {
    console.warn('[capture] annotated seed comparison not found; skipped comparison pages');
  }

  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
