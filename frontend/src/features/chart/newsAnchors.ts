import type { Bar, NewsItem, Timeframe } from '../../types/api';
import { alignEventToBar, timeframeSeconds } from '../../utils/eventAlign';

/** Grace window for news that lands outside any real candle (pre/post market, weekends). */
const SNAP_GRACE_SEC = 4 * 24 * 60 * 60;

export function toSec(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function directionColor(direction: string): string {
  if (direction === 'positive') return '#22c55e';
  if (direction === 'negative') return '#ef4444';
  return '#a78bfa';
}

export function aggregateDirection(items: NewsItem[]): string {
  let pos = 0;
  let neg = 0;
  for (const i of items) {
    if (i.direction === 'positive') pos += 1;
    if (i.direction === 'negative') neg += 1;
  }
  if (pos > neg) return 'positive';
  if (neg > pos) return 'negative';
  return 'uncertain';
}

/**
 * Attach news to real candles only — no synthetic bars.
 * News inside a candle goes to that candle; news in a gap (pre/post market, weekend,
 * holiday) snaps to the nearest existing candle so nothing in the window is lost.
 */
export function indexNewsByBar(
  bars: Bar[],
  newsItems: NewsItem[],
  timeframe: Timeframe,
): Map<number, NewsItem[]> {
  const map = new Map<number, NewsItem[]>();
  if (!bars.length || !newsItems.length) return map;

  const barSecs = bars.map((b) => toSec(b.timestamp));
  const duration = timeframeSeconds(timeframe);
  const firstBar = barSecs[0]!;

  // Timezone conversion is expensive, so for 1Day resolve each bar's session date
  // once up front instead of re-deriving it for every news item.
  let barSecByDay: Map<number, number> | null = null;
  let sortedDays: number[] = [];
  if (timeframe === '1Day') {
    barSecByDay = new Map();
    for (const t of barSecs) {
      barSecByDay.set(alignEventToBar(t * 1000, '1Day').getTime(), t);
    }
    sortedDays = Array.from(barSecByDay.keys()).sort((a, b) => a - b);
  }

  for (const item of newsItems) {
    const publishedSec = Math.floor(new Date(item.publishedAt).getTime() / 1000);
    let snapped: number | null = null;

    if (timeframe === '1Day' && barSecByDay) {
      const newsDay = alignEventToBar(item.publishedAt, '1Day').getTime();
      const exact = barSecByDay.get(newsDay);
      if (exact != null) {
        snapped = exact;
      } else {
        // Weekend / holiday / overnight: attach to the closest trading day we have
        let lo = 0;
        let hi = sortedDays.length - 1;
        let best: number | null = null;
        let bestGap = Infinity;
        while (lo <= hi) {
          const mid = (lo + hi) >> 1;
          const day = sortedDays[mid]!;
          const gap = Math.abs(day - newsDay);
          if (gap < bestGap) {
            bestGap = gap;
            best = day;
          }
          if (day < newsDay) lo = mid + 1;
          else hi = mid - 1;
        }
        if (best != null && bestGap <= SNAP_GRACE_SEC * 1000) {
          snapped = barSecByDay.get(best) ?? null;
        }
      }
    } else {
      // Rightmost bar start <= publish time
      let lo = 0;
      let hi = barSecs.length - 1;
      let idx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const t = barSecs[mid]!;
        if (t <= publishedSec) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      if (idx >= 0) {
        const start = barSecs[idx]!;
        const next = barSecs[idx + 1];
        // A candle ends after its own duration, NOT at the next bar. Using the next
        // bar as the end made the overnight gap part of the previous candle, e.g.
        // 09:26 news could incorrectly land on the prior session's 15:30 bar.
        const end = start + duration;
        if (publishedSec < end) {
          snapped = start;
        } else if (next != null) {
          // Session gap: whichever real candle boundary is closer in time.
          snapped = publishedSec - end <= next - publishedSec ? start : next;
        } else if (publishedSec - end <= SNAP_GRACE_SEC) {
          // After the last candle (post-market / not yet traded)
          snapped = start;
        }
      } else if (firstBar - publishedSec <= SNAP_GRACE_SEC) {
        // Just before the window opens (pre-market of the first session)
        snapped = firstBar;
      }
    }

    if (snapped == null) continue;
    const list = map.get(snapped) ?? [];
    list.push(item);
    map.set(snapped, list);
  }

  for (const [, list] of map) {
    list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }
  return map;
}

/** Flatten news that is visible on the current bars/timeframe (for News list). */
export function visibleNewsForBars(
  bars: Bar[],
  newsItems: NewsItem[],
  timeframe: Timeframe,
): NewsItem[] {
  const map = indexNewsByBar(bars, newsItems, timeframe);
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  const times = Array.from(map.keys()).sort((a, b) => b - a);
  for (const t of times) {
    for (const item of map.get(t) ?? []) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
