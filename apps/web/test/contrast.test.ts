import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The accessibility ticket fixes a 10px type floor, so every text colour we
 * ship must clear WCAG AA for normal-size text (4.5:1) against the surfaces it
 * is placed on. Tokens live in one block in globals.css; parse them from there
 * so the assertion tracks the real stylesheet rather than a copy.
 */
const css = readFileSync(
  path.resolve(import.meta.dirname, '../src/app/globals.css'),
  'utf8',
);

function token(name: string) {
  const match = css.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`Missing colour token: ${name}`);
  return match[1];
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

const TEXT_ON_SURFACES = [
  'bg',
  'surface',
  'neutral-800',
  'accent-900',
] as const;

const TEXT_TOKENS = [
  'text',
  'neutral-100',
  'neutral-200',
  'neutral-300',
  'neutral-400',
  'neutral-500',
  'accent-200',
  'accent-300',
  'danger',
] as const;

describe('design token contrast', () => {
  for (const background of TEXT_ON_SURFACES) {
    for (const foreground of TEXT_TOKENS) {
      it(`${foreground} on ${background} is readable at small sizes`, () => {
        expect(contrast(token(foreground), token(background))).toBeGreaterThanOrEqual(
          4.5,
        );
      });
    }
  }

  it('sub-labels on a selected control are readable', () => {
    expect(contrast(token('neutral-300'), token('neutral-700'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
