/**
 * Pure technical indicator functions.
 * Never mutate input arrays; return NaN-free series (skip warmup periods).
 */

export interface MacdPoint {
  macd: number;
  signal: number;
  histogram: number;
}

function isValid(n: number): boolean {
  return Number.isFinite(n);
}

/** Simple Moving Average */
export function sma(values: readonly number[], period: number): number[] {
  if (period <= 0) return [];
  const result: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < period) {
      continue;
    }
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += values[j] ?? 0;
    }
    result.push(sum / period);
  }
  return result;
}

/** Exponential Moving Average (returns full-length aligned series with leading null-equivalent gaps skipped) */
export function ema(values: readonly number[], period: number): number[] {
  if (period <= 0 || values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [];
  let prev = values[0] ?? 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i] ?? 0;
    if (i === 0) {
      prev = v;
      if (i + 1 >= period) {
        result.push(v);
      }
      continue;
    }
    prev = v * k + prev * (1 - k);
    if (i + 1 >= period) {
      result.push(prev);
    }
  }
  return result;
}

/** MACD (12, 26, 9 default) */
export function macd(
  values: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9,
): MacdPoint[] {
  if (values.length < slowPeriod) return [];

  const fastEma = expandEma(values, fastPeriod);
  const slowEma = expandEma(values, slowPeriod);
  const macdLine: number[] = [];

  for (let i = 0; i < values.length; i++) {
    const f = fastEma[i];
    const s = slowEma[i];
    if (f === undefined || s === undefined) continue;
    macdLine.push(f - s);
  }

  const signalLine = expandEma(macdLine, signalPeriod);
  const result: MacdPoint[] = [];
  const offset = values.length - macdLine.length;

  for (let i = 0; i < macdLine.length; i++) {
    const m = macdLine[i];
    const sigIdx = i;
    const sig = signalLine[sigIdx];
    if (m === undefined || sig === undefined) continue;
    if (i + 1 < signalPeriod) continue;
    result.push({
      macd: m,
      signal: sig,
      histogram: m - sig,
    });
  }

  void offset;
  return result;
}

function expandEma(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = new Array(values.length);
  if (values.length === 0) return out;
  let prev = values[0] ?? 0;
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] ?? 0;
    prev = v * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

/** Relative Strength Index (Wilder smoothing) */
export function rsi(values: readonly number[], period = 14): number[] {
  if (period <= 0 || values.length <= period) return [];

  const gains: number[] = [];
  const losses: number[] = [];

  for (let i = 1; i < values.length; i++) {
    const diff = (values[i] ?? 0) - (values[i - 1] ?? 0);
    gains.push(diff > 0 ? diff : 0);
    losses.push(diff < 0 ? -diff : 0);
  }

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i] ?? 0;
    avgLoss += losses[i] ?? 0;
  }
  avgGain /= period;
  avgLoss /= period;

  const result: number[] = [];

  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  if (isValid(firstRsi)) result.push(firstRsi);

  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + (gains[i] ?? 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (losses[i] ?? 0)) / period;
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss;
    const val = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
    if (isValid(val)) result.push(val);
  }

  return result;
}

/** Align indicator series to bar timestamps (pad front with undefined for warmup) */
export function alignSeries<T>(barsLength: number, warmup: number, series: T[]): (T | undefined)[] {
  const pad = barsLength - series.length;
  const aligned: (T | undefined)[] = new Array(pad).fill(undefined);
  for (const v of series) {
    aligned.push(v);
  }
  void warmup;
  return aligned.slice(-barsLength);
}

/** Bollinger Bands — returns middle/upper/lower aligned to full length (warmup skipped). */
export function bollinger(
  values: readonly number[],
  period = 20,
  stdDev = 2,
): { middle: number; upper: number; lower: number }[] {
  if (period <= 0 || values.length < period) return [];
  const out: { middle: number; upper: number; lower: number }[] = [];
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += values[j] ?? 0;
    const mid = sum / period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = (values[j] ?? 0) - mid;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / period);
    out.push({ middle: mid, upper: mid + stdDev * sd, lower: mid - stdDev * sd });
  }
  return out;
}

/** Stochastic %K / %D */
export function stochastic(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  kPeriod = 14,
  dPeriod = 3,
): { k: number; d: number }[] {
  const n = closes.length;
  if (n < kPeriod) return [];
  const rawK: number[] = [];
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j] ?? -Infinity);
      lo = Math.min(lo, lows[j] ?? Infinity);
    }
    const range = hi - lo;
    rawK.push(range === 0 ? 50 : (((closes[i] ?? 0) - lo) / range) * 100);
  }
  const dLine = sma(rawK, dPeriod);
  const out: { k: number; d: number }[] = [];
  const offset = rawK.length - dLine.length;
  for (let i = 0; i < dLine.length; i++) {
    out.push({ k: rawK[offset + i]!, d: dLine[i]! });
  }
  return out;
}

/** Average True Range */
export function atr(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14,
): number[] {
  if (closes.length < period + 1) return [];
  const trs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const h = highs[i] ?? 0;
    const l = lows[i] ?? 0;
    const prevC = closes[i - 1] ?? 0;
    trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
  }
  // Wilder smoothing
  let avg = 0;
  for (let i = 0; i < period; i++) avg += trs[i] ?? 0;
  avg /= period;
  const out: number[] = [avg];
  for (let i = period; i < trs.length; i++) {
    avg = (avg * (period - 1) + (trs[i] ?? 0)) / period;
    out.push(avg);
  }
  return out;
}

/** Commodity Channel Index */
export function cci(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 20,
): number[] {
  const n = closes.length;
  if (n < period) return [];
  const tp = closes.map((c, i) => ((highs[i] ?? 0) + (lows[i] ?? 0) + c) / 3);
  const out: number[] = [];
  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j] ?? 0;
    const mean = sum / period;
    let mad = 0;
    for (let j = i - period + 1; j <= i; j++) mad += Math.abs((tp[j] ?? 0) - mean);
    mad /= period;
    out.push(mad === 0 ? 0 : ((tp[i] ?? 0) - mean) / (0.015 * mad));
  }
  return out;
}

/** On-Balance Volume */
export function obv(closes: readonly number[], volumes: readonly number[]): number[] {
  if (closes.length === 0) return [];
  const out: number[] = [volumes[0] ?? 0];
  for (let i = 1; i < closes.length; i++) {
    const prev = out[i - 1] ?? 0;
    const vol = volumes[i] ?? 0;
    if ((closes[i] ?? 0) > (closes[i - 1] ?? 0)) out.push(prev + vol);
    else if ((closes[i] ?? 0) < (closes[i - 1] ?? 0)) out.push(prev - vol);
    else out.push(prev);
  }
  return out;
}

/** Williams %R */
export function williamsR(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14,
): number[] {
  const n = closes.length;
  if (n < period) return [];
  const out: number[] = [];
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, highs[j] ?? -Infinity);
      lo = Math.min(lo, lows[j] ?? Infinity);
    }
    const range = hi - lo;
    out.push(range === 0 ? -50 : ((hi - (closes[i] ?? 0)) / range) * -100);
  }
  return out;
}

/** Rate of Change (%) */
export function roc(values: readonly number[], period = 12): number[] {
  if (period <= 0 || values.length <= period) return [];
  const out: number[] = [];
  for (let i = period; i < values.length; i++) {
    const base = values[i - period] ?? 0;
    out.push(base === 0 ? 0 : (((values[i] ?? 0) - base) / base) * 100);
  }
  return out;
}

/** Money Flow Index */
export function mfi(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  volumes: readonly number[],
  period = 14,
): number[] {
  if (closes.length <= period) return [];
  const tp = closes.map((c, i) => ((highs[i] ?? 0) + (lows[i] ?? 0) + c) / 3);
  const positive: number[] = [];
  const negative: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const flow = (tp[i] ?? 0) * (volumes[i] ?? 0);
    positive.push((tp[i] ?? 0) > (tp[i - 1] ?? 0) ? flow : 0);
    negative.push((tp[i] ?? 0) < (tp[i - 1] ?? 0) ? flow : 0);
  }
  const out: number[] = [];
  for (let i = period - 1; i < positive.length; i++) {
    let pos = 0;
    let neg = 0;
    for (let j = i - period + 1; j <= i; j++) {
      pos += positive[j] ?? 0;
      neg += negative[j] ?? 0;
    }
    out.push(neg === 0 ? 100 : 100 - 100 / (1 + pos / neg));
  }
  return out;
}

/** Chaikin Money Flow */
export function cmf(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  volumes: readonly number[],
  period = 20,
): number[] {
  if (closes.length < period) return [];
  const mfv = closes.map((c, i) => {
    const range = (highs[i] ?? 0) - (lows[i] ?? 0);
    const multiplier = range === 0 ? 0 : ((c - (lows[i] ?? 0)) - ((highs[i] ?? 0) - c)) / range;
    return multiplier * (volumes[i] ?? 0);
  });
  const out: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    let flow = 0;
    let volume = 0;
    for (let j = i - period + 1; j <= i; j++) {
      flow += mfv[j] ?? 0;
      volume += volumes[j] ?? 0;
    }
    out.push(volume === 0 ? 0 : flow / volume);
  }
  return out;
}

/** Average Directional Index (ADX) */
export function adx(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  period = 14,
): number[] {
  if (closes.length < period * 2) return [];
  const tr: number[] = [];
  const plusDm: number[] = [];
  const minusDm: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const up = (highs[i] ?? 0) - (highs[i - 1] ?? 0);
    const down = (lows[i - 1] ?? 0) - (lows[i] ?? 0);
    plusDm.push(up > down && up > 0 ? up : 0);
    minusDm.push(down > up && down > 0 ? down : 0);
    tr.push(
      Math.max(
        (highs[i] ?? 0) - (lows[i] ?? 0),
        Math.abs((highs[i] ?? 0) - (closes[i - 1] ?? 0)),
        Math.abs((lows[i] ?? 0) - (closes[i - 1] ?? 0)),
      ),
    );
  }

  const dx: number[] = [];
  for (let i = period - 1; i < tr.length; i++) {
    let trSum = 0;
    let plusSum = 0;
    let minusSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      trSum += tr[j] ?? 0;
      plusSum += plusDm[j] ?? 0;
      minusSum += minusDm[j] ?? 0;
    }
    const plusDi = trSum === 0 ? 0 : (plusSum / trSum) * 100;
    const minusDi = trSum === 0 ? 0 : (minusSum / trSum) * 100;
    const denom = plusDi + minusDi;
    dx.push(denom === 0 ? 0 : (Math.abs(plusDi - minusDi) / denom) * 100);
  }
  return sma(dx, period);
}

/** Cumulative VWAP for the loaded window. */
export function vwap(
  highs: readonly number[],
  lows: readonly number[],
  closes: readonly number[],
  volumes: readonly number[],
): number[] {
  let pv = 0;
  let volume = 0;
  return closes.map((close, i) => {
    const typical = ((highs[i] ?? close) + (lows[i] ?? close) + close) / 3;
    const v = volumes[i] ?? 0;
    pv += typical * v;
    volume += v;
    return volume === 0 ? close : pv / volume;
  });
}

/** Parabolic SAR. */
export function parabolicSar(
  highs: readonly number[],
  lows: readonly number[],
  step = 0.02,
  maxStep = 0.2,
): number[] {
  if (highs.length < 2) return [];
  const out: number[] = [lows[0] ?? 0];
  let rising = (highs[1] ?? 0) >= (highs[0] ?? 0);
  let sar = rising ? (lows[0] ?? 0) : (highs[0] ?? 0);
  let extreme = rising ? (highs[0] ?? 0) : (lows[0] ?? 0);
  let acceleration = step;

  for (let i = 1; i < highs.length; i++) {
    sar += acceleration * (extreme - sar);
    if (rising) {
      sar = Math.min(sar, lows[i - 1] ?? sar, lows[i - 2] ?? sar);
      if ((lows[i] ?? 0) < sar) {
        rising = false;
        sar = extreme;
        extreme = lows[i] ?? sar;
        acceleration = step;
      } else if ((highs[i] ?? 0) > extreme) {
        extreme = highs[i] ?? extreme;
        acceleration = Math.min(maxStep, acceleration + step);
      }
    } else {
      sar = Math.max(sar, highs[i - 1] ?? sar, highs[i - 2] ?? sar);
      if ((highs[i] ?? 0) > sar) {
        rising = true;
        sar = extreme;
        extreme = highs[i] ?? sar;
        acceleration = step;
      } else if ((lows[i] ?? 0) < extreme) {
        extreme = lows[i] ?? extreme;
        acceleration = Math.min(maxStep, acceleration + step);
      }
    }
    out.push(sar);
  }
  return out;
}

/** Rolling support/resistance (lowest low / highest high). */
export function supportResistance(
  highs: readonly number[],
  lows: readonly number[],
  period = 20,
): { support: number; resistance: number }[] {
  if (highs.length < period) return [];
  const out: { support: number; resistance: number }[] = [];
  for (let i = period - 1; i < highs.length; i++) {
    let support = Infinity;
    let resistance = -Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      support = Math.min(support, lows[j] ?? Infinity);
      resistance = Math.max(resistance, highs[j] ?? -Infinity);
    }
    out.push({ support, resistance });
  }
  return out;
}

/** Donchian channel. */
export function donchian(
  highs: readonly number[],
  lows: readonly number[],
  period = 20,
): { upper: number; middle: number; lower: number }[] {
  return supportResistance(highs, lows, period).map(({ support, resistance }) => ({
    upper: resistance,
    middle: (resistance + support) / 2,
    lower: support,
  }));
}
