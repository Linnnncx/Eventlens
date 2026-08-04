import { describe, expect, it } from 'vitest';
import { shouldSelectMobileBarTap } from '../src/mobile/components/mobileChartHitTest';

describe('mobile chart tap hit testing', () => {
  it('selects a tiny-body candle anywhere along its wick', () => {
    expect(shouldSelectMobileBarTap({ pointerY: 120, highY: 100, lowY: 140, hasNewsAnchor: false })).toBe(true);
  });

  it('selects only the marker-sized zone above an anchored candle', () => {
    expect(shouldSelectMobileBarTap({ pointerY: 82, highY: 100, lowY: 140, hasNewsAnchor: true })).toBe(true);
  });

  it('does not select distant empty space even on an anchored bar', () => {
    expect(shouldSelectMobileBarTap({ pointerY: 50, highY: 100, lowY: 140, hasNewsAnchor: true })).toBe(false);
    expect(shouldSelectMobileBarTap({ pointerY: 82, highY: 100, lowY: 140, hasNewsAnchor: false })).toBe(false);
  });
});
