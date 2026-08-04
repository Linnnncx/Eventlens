import type { Bar, EventReaction } from '../types/api';

function toMs(input: string | number | Date): number {
  if (input instanceof Date) return input.getTime();
  if (typeof input === 'number') return input < 1e12 ? input * 1000 : input;
  return new Date(input).getTime();
}

function priceAtOrBefore(bars: Bar[], tsMs: number): number | null {
  let best: number | null = null;
  for (const b of bars) {
    const t = toMs(b.timestamp);
    if (t <= tsMs) best = b.close;
    else break;
  }
  return best;
}

function priceAtOrAfter(bars: Bar[], tsMs: number): number | null {
  for (const b of bars) {
    if (toMs(b.timestamp) >= tsMs) return b.close;
  }
  return null;
}

/**
 * Lightweight client-side event reaction (mirrors backend compute_event_reaction)
 * so the news grid can show Post 5m / Max up without N network round-trips.
 */
export function computeEventReactionLocal(
  eventId: string,
  symbol: string,
  publishedAt: string,
  bars: Bar[],
): Pick<
  EventReaction,
  'eventId' | 'symbol' | 'publishedAt' | 'post5m' | 'post30m' | 'post60m' | 'maxUp' | 'maxDrawdown' | 'volumeRatio'
> | null {
  if (!bars.length) return null;
  const t0 = toMs(publishedAt);
  const p0 = priceAtOrBefore(bars, t0);
  if (p0 == null || p0 === 0) return null;

  const pct = (deltaMs: number, after: boolean): number | null => {
    const target = after ? t0 + deltaMs : t0 - deltaMs;
    const px = after ? priceAtOrAfter(bars, target) : priceAtOrBefore(bars, target);
    if (px == null) return null;
    if (after) return (px - p0) / p0;
    return px ? (p0 - px) / px : null;
  };

  const window = bars.filter((b) => {
    const t = toMs(b.timestamp);
    return t >= t0 && t <= t0 + 2 * 60 * 60 * 1000;
  });
  const prior = bars.filter((b) => {
    const t = toMs(b.timestamp);
    return t >= t0 - 5 * 24 * 60 * 60 * 1000 && t < t0;
  });

  let volumeRatio: number | null = null;
  if (window.length && prior.length) {
    const avg = prior.reduce((s, b) => s + b.volume, 0) / prior.length;
    const cur = window.reduce((s, b) => s + b.volume, 0) / window.length;
    if (avg > 0) volumeRatio = cur / avg;
  }

  let maxUp: number | null = null;
  let maxDrawdown: number | null = null;
  if (window.length) {
    const highs = window.map((b) => b.high);
    const lows = window.map((b) => b.low);
    maxUp = (Math.max(...highs) - p0) / p0;
    maxDrawdown = (Math.min(...lows) - p0) / p0;
  }

  return {
    eventId,
    symbol,
    publishedAt,
    post5m: pct(5 * 60 * 1000, true),
    post30m: pct(30 * 60 * 1000, true),
    post60m: pct(60 * 60 * 1000, true),
    maxUp,
    maxDrawdown,
    volumeRatio,
  };
}

export function formatReactionPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`;
}

export function formatReactionRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(2)}×`;
}
