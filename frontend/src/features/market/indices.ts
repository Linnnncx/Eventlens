/** Major US index tickers shown on the workbench strip. */
export const INDEX_STRIP = [
  { symbol: 'DJI', yahoo: '^DJI', label: '道琼斯', short: '道指' },
  { symbol: 'SPX', yahoo: '^GSPC', label: '标普500', short: '标普' },
  { symbol: 'IXIC', yahoo: '^IXIC', label: '纳斯达克', short: '纳指' },
] as const;

const INDEX_SET = new Set(INDEX_STRIP.flatMap((i) => [i.symbol, i.yahoo, i.yahoo.replace('^', '')]));

/** Indices have no company news — skip anchors / events fetch. */
export function isIndexSymbol(symbol: string): boolean {
  const s = symbol.trim().toUpperCase();
  if (INDEX_SET.has(s)) return true;
  if (s.startsWith('^')) return true;
  return false;
}
