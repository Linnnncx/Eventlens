export type MainIndicatorId =
  | 'ma'
  | 'ema'
  | 'boll'
  | 'vwap'
  | 'sar'
  | 'support'
  | 'donchian';

export type SubIndicatorId =
  | 'macd'
  | 'rsi'
  | 'stoch'
  | 'cci'
  | 'willr'
  | 'atr'
  | 'obv'
  | 'adx'
  | 'mfi'
  | 'cmf'
  | 'roc';

export const MAIN_INDICATORS: { id: MainIndicatorId; label: string }[] = [
  { id: 'ma', label: 'MA 20/50' },
  { id: 'ema', label: 'EMA 12/26' },
  { id: 'boll', label: 'BOLL 20,2' },
  { id: 'vwap', label: 'VWAP' },
  { id: 'sar', label: 'SAR' },
  { id: 'support', label: '支撑/压力 20' },
  { id: 'donchian', label: 'Donchian 20' },
];

export const SUB_INDICATORS: { id: SubIndicatorId; label: string }[] = [
  { id: 'macd', label: 'MACD' },
  { id: 'rsi', label: 'RSI' },
  { id: 'stoch', label: 'KDJ/Stoch' },
  { id: 'cci', label: 'CCI' },
  { id: 'willr', label: 'Williams %R' },
  { id: 'atr', label: 'ATR' },
  { id: 'obv', label: 'OBV' },
  { id: 'adx', label: 'ADX' },
  { id: 'mfi', label: 'MFI' },
  { id: 'cmf', label: 'CMF' },
  { id: 'roc', label: 'ROC' },
];

const MAIN_KEY = 'eventlens.main-indicators.v2';
const SUB_KEY = 'eventlens.sub-indicators.v2';

function load<T extends string>(key: string, fallback: T[]): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '') as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export function loadMainIndicators(): MainIndicatorId[] {
  return load(MAIN_KEY, ['ma']);
}

export function loadSubIndicators(): SubIndicatorId[] {
  return load(SUB_KEY, ['macd', 'rsi']);
}

export function saveMainIndicators(ids: MainIndicatorId[]) {
  localStorage.setItem(MAIN_KEY, JSON.stringify(ids));
}

export function saveSubIndicators(ids: SubIndicatorId[]) {
  localStorage.setItem(SUB_KEY, JSON.stringify(ids));
}

const PANE_HEIGHT_KEY = 'eventlens.sub-pane-heights.v1';
export const DEFAULT_SUB_PANE_HEIGHT = 96;
export const MIN_SUB_PANE_HEIGHT = 56;
export const MAX_SUB_PANE_HEIGHT = 320;

export function loadSubPaneHeights(): Partial<Record<SubIndicatorId, number>> {
  try {
    const raw = localStorage.getItem(PANE_HEIGHT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<SubIndicatorId, number>>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveSubPaneHeights(heights: Partial<Record<SubIndicatorId, number>>) {
  localStorage.setItem(PANE_HEIGHT_KEY, JSON.stringify(heights));
}

export function clampSubPaneHeight(value: number): number {
  return Math.min(MAX_SUB_PANE_HEIGHT, Math.max(MIN_SUB_PANE_HEIGHT, Math.round(value)));
}
