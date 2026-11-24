import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { WeightClassMark } from '../src/components/ui/weight-class-mark';

function render(props: Parameters<typeof WeightClassMark>[0]) {
  return renderToStaticMarkup(<WeightClassMark {...props} />);
}

describe('WeightClassMark', () => {
  it('draws a cloud and the Frontier title when a Model has no class', () => {
    const html = render({ weightClass: null });

    expect(html).toContain('title="Frontier API · hosted only · size undisclosed"');
    expect(html).toContain('aria-label="Frontier API · hosted only · size undisclosed"');
    expect(html).not.toContain('data-size-glyph');
    expect(html).toContain('<svg');
  });

  it('draws the mini glyph and names the Run size for a class with a GB value', () => {
    const html = render({ weightClass: 'light', runSizeGb: 32 });

    expect(html).toContain('data-size-glyph="light"');
    expect(html).toContain('title="Light weight · 32 GB to run at 4-bit"');
    expect(html).toContain('aria-label="Light weight · 32 GB to run at 4-bit"');
    expect(html).not.toContain('<svg');
  });

  it('falls back to the class range when no GB value is known', () => {
    const html = render({ weightClass: 'super-heavy' });

    expect(html).toContain('title="Super Heavy weight · 300 GB+"');
  });

  it('prints the short label for callers that render text', () => {
    const html = render({ weightClass: 'middle', runSizeGb: 64, showLabel: true });

    expect(html).toContain('Middle');
    expect(html).toContain('data-size-glyph="middle"');
    expect(html).not.toContain('aria-label=');
  });
});
