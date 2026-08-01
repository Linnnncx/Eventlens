import { describe, expect, it } from 'vitest';
import { sma, ema, macd, rsi } from '../src/utils/indicators';

describe('sma', () => {
  it('computes simple moving average', () => {
    const values = [1, 2, 3, 4, 5];
    expect(sma(values, 3)).toEqual([2, 3, 4]);
  });

  it('returns empty for invalid period', () => {
    expect(sma([1, 2, 3], 0)).toEqual([]);
  });

  it('does not mutate input', () => {
    const values = [10, 20, 30, 40];
    const copy = [...values];
    sma(values, 2);
    expect(values).toEqual(copy);
  });
});

describe('ema', () => {
  it('returns values after warmup period', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = ema(values, 3);
    expect(result.length).toBe(8);
    expect(result.every((v) => Number.isFinite(v))).toBe(true);
  });

  it('does not mutate input', () => {
    const values = [1, 2, 3, 4, 5];
    const copy = [...values];
    ema(values, 2);
    expect(values).toEqual(copy);
  });
});

describe('macd', () => {
  it('produces macd signal histogram without NaN', () => {
    const values = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i / 3) * 5 + i * 0.1);
    const result = macd(values);
    expect(result.length).toBeGreaterThan(0);
    for (const pt of result) {
      expect(Number.isFinite(pt.macd)).toBe(true);
      expect(Number.isFinite(pt.signal)).toBe(true);
      expect(Number.isFinite(pt.histogram)).toBe(true);
    }
  });

  it('returns empty for short series', () => {
    expect(macd([1, 2, 3])).toEqual([]);
  });
});

describe('rsi', () => {
  it('computes RSI in valid range', () => {
    const values = [
      44, 44.5, 43.8, 44.2, 45.1, 45.5, 45.2, 46.1, 46.5, 46.2,
      47, 46.8, 47.5, 47.2, 48, 47.8, 48.5, 48.2, 49, 48.9,
    ];
    const result = rsi(values, 14);
    expect(result.length).toBeGreaterThan(0);
    for (const v of result) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
      expect(Number.isFinite(v)).toBe(true);
    }
  });

  it('returns empty when insufficient data', () => {
    expect(rsi([1, 2, 3], 14)).toEqual([]);
  });

  it('does not mutate input', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const copy = [...values];
    rsi(values, 14);
    expect(values).toEqual(copy);
  });
});
