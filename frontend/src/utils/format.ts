import { formatInTimeZone } from 'date-fns-tz';

export function formatPrice(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

export function formatChange(value: number, decimals = 2): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${formatPrice(value, decimals)}`;
}

export function formatCompact(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toFixed(0);
}

export function formatCurrency(value: number): string {
  return `$${formatPrice(value)}`;
}

export function changeColorClass(value: number): string {
  if (value > 0) return 'text-up';
  if (value < 0) return 'text-down';
  return 'text-muted';
}

export function importanceColor(importance: string): string {
  switch (importance) {
    case 'high':
      return 'text-down';
    case 'medium':
      return 'text-news';
    default:
      return 'text-muted';
  }
}

export function directionLabel(direction: string): string {
  switch (direction) {
    case 'positive':
      return 'Bullish';
    case 'negative':
      return 'Bearish';
    case 'neutral':
      return 'Neutral';
    default:
      return 'Uncertain';
  }
}

export function directionColor(direction: string): string {
  switch (direction) {
    case 'positive':
      return 'text-up';
    case 'negative':
      return 'text-down';
    default:
      return 'text-muted';
  }
}

export function sessionLabel(session: string, isOpen: boolean): string {
  if (isOpen) return 'Market Open';
  if (session === 'pre') return 'Pre-Market';
  if (session === 'post') return 'After Hours';
  return 'Market Closed';
}

/** US equity display timezone — chart axis and news timestamps stay aligned. */
export const MARKET_TIMEZONE = 'America/New_York';

function toDate(input: Date | string | number): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') {
    return new Date(input < 1e12 ? input * 1000 : input);
  }
  return new Date(input);
}

export type MarketSession = 'pre' | 'regular' | 'post' | 'closed';

/**
 * Classify a timestamp into a US equity session (ET). News published outside regular
 * hours cannot sit on its own candle, so the UI flags it instead of silently snapping.
 */
export function marketSessionOf(input: Date | string | number): MarketSession {
  const date = toDate(input);
  const isoDay = Number(formatInTimeZone(date, MARKET_TIMEZONE, 'i'));
  const minutes =
    Number(formatInTimeZone(date, MARKET_TIMEZONE, 'H')) * 60 +
    Number(formatInTimeZone(date, MARKET_TIMEZONE, 'm'));
  if (isoDay > 5) return 'closed';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'regular';
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'pre';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'post';
  return 'closed';
}

export function marketSessionLabel(session: MarketSession): string {
  switch (session) {
    case 'pre':
      return '盘前';
    case 'post':
      return '盘后';
    case 'closed':
      return '休市';
    default:
      return '盘中';
  }
}

export function marketSessionClass(session: MarketSession): string {
  switch (session) {
    case 'pre':
      return 'border-primary/40 text-primary';
    case 'post':
      return 'border-news/40 text-news';
    case 'closed':
      return 'border-border text-muted';
    default:
      return 'border-up/40 text-up';
  }
}

/** Format a time in America/New_York (ET), e.g. "Jul 30, 18:00 ET". */
export function formatMarketTime(
  input: Date | string | number,
  pattern = 'MMM d, HH:mm',
  withTz = true,
): string {
  const formatted = formatInTimeZone(toDate(input), MARKET_TIMEZONE, pattern);
  return withTz ? `${formatted} ET` : formatted;
}

/** Lightweight Charts crosshair label in ET. */
export function marketChartTimeFormatter(time: number | string): string {
  if (typeof time === 'string') return time;
  return formatMarketTime(time, 'MMM d, yyyy HH:mm', true);
}

/** Lightweight Charts tick marks in ET. tickMarkType: Year=0 Month=1 Day=2 Time=3 TimeWithSeconds=4 */
export function marketTickMarkFormatter(time: number | string, tickMarkType: number): string {
  if (typeof time === 'string') return time;
  switch (tickMarkType) {
    case 0:
      return formatInTimeZone(toDate(time), MARKET_TIMEZONE, 'yyyy');
    case 1:
      return formatInTimeZone(toDate(time), MARKET_TIMEZONE, 'MMM yyyy');
    case 2:
      return formatInTimeZone(toDate(time), MARKET_TIMEZONE, 'MMM d');
    case 3:
      return formatInTimeZone(toDate(time), MARKET_TIMEZONE, 'HH:mm');
    case 4:
      return formatInTimeZone(toDate(time), MARKET_TIMEZONE, 'HH:mm:ss');
    default:
      return formatMarketTime(time, 'MMM d HH:mm', false);
  }
}
