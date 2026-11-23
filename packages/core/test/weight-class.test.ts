import { describe, expect, it } from 'vitest';
import {
  formatRunSize,
  memoryBarPercent,
  parameterSummary,
  parseModelClassTab,
  weightClassDefinition,
  weightClassLabel,
} from '../src/domain/weight-class';

describe('Weight class definitions', () => {
  it('orders six classes and labels a Model by its class', () => {
    expect(weightClassDefinition('heavy')?.range).toBe('144–272 GB');
    expect(weightClassLabel('light')).toBe('Light weight');
    expect(weightClassLabel('super-heavy')).toBe('Super Heavy weight');
  });

  it('labels a classless Model as Frontier API', () => {
    expect(weightClassLabel(null)).toBe('Frontier API');
  });
});

describe('Run size formatting', () => {
  it('shows gigabytes below a thousand and terabytes above', () => {
    expect(formatRunSize(4)).toBe('4 GB');
    expect(formatRunSize(104)).toBe('104 GB');
    expect(formatRunSize(1008)).toBe('1.0 TB');
    expect(formatRunSize(1548)).toBe('1.5 TB');
  });

  it('places GB on one global log scale from 3 GB to 2 TB', () => {
    expect(memoryBarPercent(3)).toBe(0);
    expect(memoryBarPercent(2000)).toBe(100);
    expect(memoryBarPercent(32)).toBeGreaterThan(memoryBarPercent(4));
    expect(memoryBarPercent(1548)).toBeGreaterThan(memoryBarPercent(304));
    expect(memoryBarPercent(1)).toBe(0);
    expect(memoryBarPercent(9999)).toBe(100);
  });
});

describe('Public model class parameter', () => {
  it('round-trips a known class and falls back to All sizes', () => {
    expect(parseModelClassTab('light')).toBe('light');
    expect(parseModelClassTab('frontier')).toBe('frontier');
    expect(parseModelClassTab('all')).toBe('all');
    expect(parseModelClassTab('nonsense')).toBe('all');
    expect(parseModelClassTab(undefined)).toBe('all');
  });
});

describe('Parameter summary', () => {
  it('names total and active parameters for a mixture of experts', () => {
    expect(parameterSummary('27B', null)).toBe('27B');
    expect(parameterSummary('27B', '27B')).toBe('27B');
    expect(parameterSummary('80B', '3B')).toBe('80B total / 3B active');
    expect(parameterSummary(null, null)).toBe('');
  });
});
