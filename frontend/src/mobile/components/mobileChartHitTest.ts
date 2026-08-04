interface MobileBarHitGeometry {
  pointerY: number;
  highY: number | null;
  lowY: number | null;
  hasNewsAnchor: boolean;
}

/** Only the candle/wick or the small circle immediately above it may select. */
export function shouldSelectMobileBarTap({
  pointerY,
  highY,
  lowY,
  hasNewsAnchor,
}: MobileBarHitGeometry): boolean {
  if (highY == null || lowY == null) return false;
  const top = Math.min(highY, lowY);
  const bottom = Math.max(highY, lowY);
  const candleHit = pointerY >= top - 5 && pointerY <= bottom + 5;
  const anchorHit = hasNewsAnchor && pointerY >= top - 30 && pointerY < top - 5;
  return candleHit || anchorHit;
}
