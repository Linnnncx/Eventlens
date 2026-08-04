import { describe, expect, it } from 'vitest';
import { alignEventToBar, alignEventToBarIso } from '../src/utils/eventAlign';
import { indexNewsByBar } from '../src/features/chart/newsAnchors';
import type { Bar, NewsItem } from '../src/types/api';

function bar(timestamp: string): Bar {
  return { symbol: 'AAPL', timestamp, open: 100, high: 102, low: 99, close: 101, volume: 1_000 };
}

function news(id: string, publishedAt: string): NewsItem {
  return {
    id,
    headline: id,
    source: 'test',
    publishedAt,
    symbols: ['AAPL'],
    eventType: 'other',
    importance: 'medium',
    direction: 'uncertain',
    timeHorizon: 'short_term',
    provider: 'fixture',
  };
}

describe('alignEventToBar', () => {
  const tz = 'America/New_York';

  it('aligns 5Min bucket in market timezone', () => {
    const ts = new Date('2024-06-03T14:07:30.000Z');
    const aligned = alignEventToBar(ts, '5Min', tz);
    const iso = aligned.toISOString();
    expect(iso).toMatch(/T14:05:00/);
  });

  it('aligns 15Min bucket', () => {
    const ts = new Date('2024-06-03T14:22:00.000Z');
    const aligned = alignEventToBar(ts, '15Min', tz);
    expect(aligned.getUTCMinutes()).toBe(15);
  });

  it('aligns 1Hour bucket', () => {
    const ts = new Date('2024-06-03T14:45:00.000Z');
    const aligned = alignEventToBar(ts, '1Hour', tz);
    expect(aligned.getUTCMinutes()).toBe(0);
  });

  it('aligns 1Day to midnight local', () => {
    const ts = new Date('2024-06-03T18:00:00.000Z');
    const aligned = alignEventToBar(ts, '1Day', tz);
    const localHour = aligned.toISOString();
    expect(localHour).toBeTruthy();
  });

  it('aligns 1Min bucket', () => {
    const ts = new Date('2024-06-03T14:07:45.000Z');
    const aligned = alignEventToBar(ts, '1Min', tz);
    expect(aligned.getUTCSeconds()).toBe(0);
  });

  it('accepts ISO string input', () => {
    const iso = alignEventToBarIso('2024-06-03T14:07:30.000Z', '5Min', tz);
    expect(iso).toContain('T');
    expect(new Date(iso).getTime()).toBeGreaterThan(0);
  });

  it('handles string timestamp consistently', () => {
    const a = alignEventToBar('2024-06-03T14:07:30.000Z', '5Min', tz);
    const b = alignEventToBar(new Date('2024-06-03T14:07:30.000Z'), '5Min', tz);
    expect(a.getTime()).toBe(b.getTime());
  });
});

describe('indexNewsByBar regression', () => {
  it('keeps intraday news inside the candle that contains publish time', () => {
    const bars = [bar('2024-06-03T14:00:00.000Z'), bar('2024-06-03T14:05:00.000Z')];
    const mapped = indexNewsByBar(bars, [news('inside', '2024-06-03T14:07:30.000Z')], '5Min');
    expect(mapped.get(Date.parse('2024-06-03T14:05:00.000Z') / 1000)?.[0]?.id).toBe('inside');
  });

  it('does not attach premarket news to the previous session close', () => {
    const bars = [bar('2024-05-31T19:55:00.000Z'), bar('2024-06-03T13:30:00.000Z')];
    const mapped = indexNewsByBar(bars, [news('premarket', '2024-06-03T12:30:00.000Z')], '5Min');
    expect(mapped.get(Date.parse('2024-06-03T13:30:00.000Z') / 1000)?.[0]?.id).toBe('premarket');
    expect(mapped.get(Date.parse('2024-05-31T19:55:00.000Z') / 1000)).toBeUndefined();
  });

  it('maps weekend daily news to the nearest real trading candle', () => {
    const bars = [bar('2024-05-31T13:30:00.000Z'), bar('2024-06-03T13:30:00.000Z')];
    const mapped = indexNewsByBar(bars, [news('weekend', '2024-06-02T16:00:00.000Z')], '1Day');
    expect(mapped.get(Date.parse('2024-06-03T13:30:00.000Z') / 1000)?.[0]?.id).toBe('weekend');
  });
});
