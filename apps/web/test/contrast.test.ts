import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every text colour we ship must clear WCAG AA for normal-size text (4.5:1)
 * against the surfaces it is placed on, in both themes. Tokens live in two
 * blocks in globals.css; parse them from there so the assertions track the
 * real stylesheet rather than a copy.
 */
const css = readFileSync(
  path.resolve(import.meta.dirname, '../src/app/globals.css'),
  'utf8',
);

const THEMES = ['dark', 'light'] as const;
type ThemeName = (typeof THEMES)[number];

const BLOCK_START: Record<ThemeName, string> = {
  dark: ':root {',
  light: '[data-theme="light"] {',
};

const TEXT_ON_SURFACES = ['bg', 'surface', 'neutral-800', 'accent-900'] as const;

const TEXT_TOKENS = [
  'text',
  'neutral-100',
  'neutral-200',
  'neutral-300',
  'neutral-400',
  'neutral-500',
  'accent-100',
  'accent-200',
  'accent-300',
  'danger',
] as const;
// neutral-600 is a border/disabled-fill step in both themes, never body text.

const COLOR_TOKENS = [
  'bg',
  'surface',
  'text',
  'accent',
  'accent-100',
  'accent-200',
  'accent-300',
  'accent-400',
  'accent-500',
  'accent-600',
  'accent-700',
  'accent-800',
  'accent-900',
  'neutral-100',
  'neutral-200',
  'neutral-300',
  'neutral-400',
  'neutral-500',
  'neutral-600',
  'neutral-700',
  'neutral-800',
  'neutral-900',
  'danger',
  'danger-surface',
] as const;

const RAW_TOKENS = [
  'code-bg',
  'code-fg',
  'on-accent',
  'r',
  'r-lg',
  'r-bubble',
  'shadow-md',
  'shadow-lg',
] as const;

function themeBlock(theme: ThemeName) {
  return balancedBlock(BLOCK_START[theme]);
}

function balancedBlock(marker: string) {
  const start = css.indexOf(marker);
  if (start === -1) throw new Error(`Missing block: ${marker}`);
  let depth = 0;
  for (let index = start + marker.length - 1; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start, index + 1);
    }
  }
  throw new Error(`Unterminated block: ${marker}`);
}

function token(block: string, name: string) {
  const match = block.match(
    new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`),
  );
  if (!match) throw new Error(`Missing colour token: ${name}`);
  return match[1];
}

function rawToken(block: string, name: string) {
  const match = block.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`Missing token: --${name}`);
  return match[1].trim();
}

function luminance(hex: string) {
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(hex.slice(1 + offset, 3 + offset), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground: string, background: string) {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

describe('design tokens', () => {
  for (const theme of THEMES) {
    it(`${theme} defines every colour token`, () => {
      const block = themeBlock(theme);
      for (const name of COLOR_TOKENS) expect(token(block, name)).toMatch(/^#/);
    });

    it(`${theme} defines code, accent-on, geometry and shadow tokens`, () => {
      const block = themeBlock(theme);
      for (const name of RAW_TOKENS) expect(rawToken(block, name)).not.toBe('');
    });
  }

  it('the system light palette matches the explicit light palette', () => {
    const systemLight = balancedBlock('@media (prefers-color-scheme: light)');
    const light = themeBlock('light');
    for (const name of COLOR_TOKENS) {
      expect(token(systemLight, name)).toBe(token(light, name));
    }
    for (const name of RAW_TOKENS) {
      expect(rawToken(systemLight, name)).toBe(rawToken(light, name));
    }
  });
});

describe('design token contrast', () => {
  for (const theme of THEMES) {
    const block = themeBlock(theme);

    for (const background of TEXT_ON_SURFACES) {
      for (const foreground of TEXT_TOKENS) {
        it(`${theme}: ${foreground} on ${background} is readable at small sizes`, () => {
          expect(
            contrast(token(block, foreground), token(block, background)),
          ).toBeGreaterThanOrEqual(4.5);
        });
      }
    }

    it(`${theme}: accent text on a faint accent fill is readable`, () => {
      for (const foreground of ['accent-200', 'accent-300']) {
        expect(
          contrast(token(block, foreground), token(block, 'accent-900')),
        ).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`${theme}: sub-labels on a selected control are readable`, () => {
      expect(
        contrast(token(block, 'neutral-300'), token(block, 'neutral-700')),
      ).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: danger text on the danger surface is readable`, () => {
      expect(
        contrast(token(block, 'danger'), token(block, 'danger-surface')),
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});
