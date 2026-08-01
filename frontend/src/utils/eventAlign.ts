import { toZonedTime, fromZonedTime } from 'date-fns-tz';
import type { Timeframe } from '../types/api';

/**
 * Align a news/event timestamp to the bar bucket start in market timezone, return UTC Date.
 * Used for 1Day (NY session date). Intraday uses UTC wall-clock buckets (see alignPublishedToBucketSec).
 */
export function alignEventToBar(
  timestamp: Date | string | number,
  timeframe: Timeframe | string,
  timezone = 'America/New_York',
): Date {
  const input = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const local = toZonedTime(input, timezone);

  let aligned: Date;
  switch (timeframe) {
    case '1Day':
      aligned = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0);
      break;
    case '1Hour':
      aligned = new Date(local.getFullYear(), local.getMonth(), local.getDate(), local.getHours(), 0, 0, 0);
      break;
    case '15Min': {
      const minute = Math.floor(local.getMinutes() / 15) * 15;
      aligned = new Date(
        local.getFullYear(),
        local.getMonth(),
        local.getDate(),
        local.getHours(),
        minute,
        0,
        0,
      );
      break;
    }
    case '5Min': {
      const minute = Math.floor(local.getMinutes() / 5) * 5;
      aligned = new Date(
        local.getFullYear(),
        local.getMonth(),
        local.getDate(),
        local.getHours(),
        minute,
        0,
        0,
      );
      break;
    }
    case '1Min':
    default: {
      aligned = new Date(
        local.getFullYear(),
        local.getMonth(),
        local.getDate(),
        local.getHours(),
        local.getMinutes(),
        0,
        0,
      );
    }
  }

  return fromZonedTime(aligned, timezone);
}

export function timeframeSeconds(timeframe: Timeframe | string): number {
  switch (timeframe) {
    case '1Min':
      return 60;
    case '5Min':
      return 5 * 60;
    case '15Min':
      return 15 * 60;
    case '1Hour':
      return 60 * 60;
    case '1Day':
      return 24 * 60 * 60;
    default:
      return 5 * 60;
  }
}

/**
 * Approximate the news window (start ISO + item budget) for a ~300-bar chart of the
 * given timeframe, so the news request can fire in parallel with the bars request.
 * Lookback is padded generously (weekends/holidays) so the oldest bar still gets news.
 */
export function newsWindowForTimeframe(timeframe: Timeframe | string): {
  start: string;
  limit: number;
} {
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  let lookbackMs: number;
  let limit: number;
  switch (timeframe) {
    case '1Day':
      lookbackMs = 470 * day; // ~300 trading days
      limit = 600;
      break;
    case '1Hour':
      lookbackMs = 75 * day; // ~300 RTH hours
      limit = 400;
      break;
    case '15Min':
      lookbackMs = 20 * day;
      limit = 300;
      break;
    case '5Min':
      lookbackMs = 8 * day;
      limit = 300;
      break;
    case '1Min':
      lookbackMs = 4 * day;
      limit = 300;
      break;
    default:
      lookbackMs = 20 * day;
      limit = 300;
  }
  return { start: new Date(now - lookbackMs).toISOString(), limit };
}

/**
 * Floor publish time to the K-line bucket the user expects on the chart.
 * Intraday: UTC wall clock (05:58 → 05:00 on 1Hour, 05:55 on 5Min).
 * 1Day: America/New_York session date start.
 */
export function alignPublishedToBucketSec(
  publishedAt: Date | string | number,
  timeframe: Timeframe | string,
): number {
  if (timeframe === '1Day') {
    return Math.floor(alignEventToBar(publishedAt, '1Day').getTime() / 1000);
  }
  const eventSec = Math.floor(
    (publishedAt instanceof Date ? publishedAt : new Date(publishedAt)).getTime() / 1000,
  );
  const duration = timeframeSeconds(timeframe);
  return Math.floor(eventSec / duration) * duration;
}

/**
 * Map news onto an existing bar time: prefer exact bucket match, else bar that contains the event.
 * Does NOT dump overnight news onto the previous session's last candle.
 */
export function mapEventToBarTime(
  eventSec: number,
  barSecs: number[],
  timeframe: Timeframe | string,
): number | null {
  if (barSecs.length === 0) return null;
  const duration = timeframeSeconds(timeframe);
  const bucket = Math.floor(eventSec / duration) * duration;

  // Exact bucket bar (including synthetic bars we injected)
  if (barSecs.includes(bucket)) return bucket;

  // For 1Day, also accept any bar on the same UTC day as the NY-aligned bucket
  if (timeframe === '1Day') {
    const day = Math.floor(bucket / 86400);
    const sameDay = barSecs.filter((t) => Math.floor(t / 86400) === day);
    if (sameDay.length) return sameDay[sameDay.length - 1]!;
  }

  // Containing bar among real Yahoo session bars (e.g. 13:30–14:30 hour)
  let lo = 0;
  let hi = barSecs.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const t = barSecs[mid]!;
    if (t <= eventSec) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx >= 0) {
    const start = barSecs[idx]!;
    const next = barSecs[idx + 1];
    const end = next != null ? next : start + duration;
    if (eventSec < end) return start;
  }

  return null;
}

export function alignEventToBarIso(
  timestamp: Date | string | number,
  timeframe: Timeframe | string,
  timezone = 'America/New_York',
): string {
  return alignEventToBar(timestamp, timeframe, timezone).toISOString();
}
