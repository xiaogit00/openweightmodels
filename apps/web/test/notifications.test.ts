import { describe, expect, it } from 'vitest';
import { notificationHref, notificationLabel } from '../src/lib/notifications';

const comparison = { id: 'comparison-1', title: 'Rate limiters', status: 'published' };

function item(overrides: {
  kind?: string;
  payload?: Record<string, unknown>;
  comparison?: typeof comparison | null;
} = {}) {
  return {
    kind: overrides.kind ?? 'job.ready',
    payload: overrides.payload ?? { jobId: 'job-1', comparisonId: comparison.id },
    comparison: overrides.comparison === undefined ? comparison : overrides.comparison,
  };
}

describe('notificationHref', () => {
  it('opens the published Comparison', () => {
    expect(notificationHref(item())).toBe('/comparisons/comparison-1');
  });

  it('opens the Job while the Comparison is still a draft', () => {
    expect(notificationHref(item({ comparison: { ...comparison, status: 'ready' } }))).toBe(
      '/comparisons/comparison-1/job',
    );
  });

  it('falls back to the Job when the Comparison cannot be loaded', () => {
    expect(notificationHref(item({ comparison: null }))).toBe(
      '/comparisons/comparison-1/job',
    );
  });

  it('has no link without a Comparison id', () => {
    expect(notificationHref(item({ payload: { jobId: 'job-1' } }))).toBeNull();
  });
});

describe('notificationLabel', () => {
  it('names a job.ready notification', () => {
    expect(notificationLabel(item())).toBe('Your comparison is ready');
  });

  it('falls back for an unknown kind', () => {
    expect(notificationLabel(item({ kind: 'something.else' }))).toBe('Notification');
  });
});
