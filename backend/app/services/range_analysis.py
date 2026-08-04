"""Build compact technical + news facts for range AI analysis."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from app.schemas.market import Bar, NewsItem

# Bars needed before the window so RSI(14)/MACD(26)/MA60/BB(20) can compute.
INDICATOR_LOOKBACK_BARS = 80


def lookback_start(start: datetime, timeframe: str) -> datetime:
    """Earliest timestamp to fetch so indicators have enough history."""
    tf = (timeframe or "1Day").lower()
    n = INDICATOR_LOOKBACK_BARS
    if tf in ("1min", "1m"):
        delta = timedelta(minutes=n * 2)  # buffer for gaps
    elif tf in ("5min", "5m"):
        delta = timedelta(minutes=n * 5 * 2)
    elif tf in ("15min", "15m"):
        delta = timedelta(minutes=n * 15 * 2)
    elif tf in ("1hour", "1h", "60min"):
        delta = timedelta(hours=n * 2)
    elif tf in ("4hour", "4h"):
        delta = timedelta(hours=n * 4 * 2)
    elif tf in ("1month", "1mo"):
        delta = timedelta(days=n * 35)
    else:
        # 1Day default — calendar days with weekend buffer
        delta = timedelta(days=int(n * 1.7) + 5)
    return start - delta


def _sma(values: list[float], n: int) -> float | None:
    if len(values) < n:
        return None
    return sum(values[-n:]) / n


def _ema_series(values: list[float], n: int) -> list[float | None]:
    if not values:
        return []
    out: list[float | None] = [None] * len(values)
    if len(values) < n:
        return out
    mult = 2 / (n + 1)
    seed = sum(values[:n]) / n
    out[n - 1] = seed
    prev = seed
    for i in range(n, len(values)):
        prev = values[i] * mult + prev * (1 - mult)
        out[i] = prev
    return out


def _rsi(closes: list[float], period: int = 14) -> float | None:
    if len(closes) < period + 1:
        return None
    gains = 0.0
    losses = 0.0
    for i in range(1, period + 1):
        d = closes[i] - closes[i - 1]
        if d >= 0:
            gains += d
        else:
            losses -= d
    avg_gain = gains / period
    avg_loss = losses / period
    for i in range(period + 1, len(closes)):
        d = closes[i] - closes[i - 1]
        gain = d if d > 0 else 0.0
        loss = -d if d < 0 else 0.0
        avg_gain = (avg_gain * (period - 1) + gain) / period
        avg_loss = (avg_loss * (period - 1) + loss) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def _atr(bars: list[Bar], period: int = 14) -> float | None:
    if len(bars) < period + 1:
        return None
    trs: list[float] = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i].high, bars[i].low, bars[i - 1].close
        trs.append(max(h - l, abs(h - pc), abs(l - pc)))
    if len(trs) < period:
        return None
    return sum(trs[-period:]) / period


def _std(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    return (sum((v - mean) ** 2 for v in values) / (len(values) - 1)) ** 0.5


def _swing_points(
    values: list[float], left: int = 2, right: int = 2
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    highs: list[tuple[int, float]] = []
    lows: list[tuple[int, float]] = []
    n = len(values)
    for i in range(left, n - right):
        window = values[i - left : i + right + 1]
        if values[i] == max(window):
            highs.append((i, values[i]))
        if values[i] == min(window):
            lows.append((i, values[i]))
    return highs, lows


def _candle_patterns(bars: list[Bar]) -> list[str]:
    if len(bars) < 2:
        return []
    patterns: list[str] = []
    a, b = bars[-2], bars[-1]
    body = abs(b.close - b.open)
    full = max(b.high - b.low, 1e-9)
    upper = b.high - max(b.open, b.close)
    lower = min(b.open, b.close) - b.low
    body_ratio = body / full

    if body_ratio < 0.1:
        patterns.append("十字星(Doji)：多空拉锯，方向待确认")
    if lower >= body * 2 and upper <= body * 0.5 and b.close >= b.open:
        patterns.append("锤头线(Hammer)：下影线长，短线有止跌试探意味")
    if upper >= body * 2 and lower <= body * 0.5 and b.close <= b.open:
        patterns.append("射击之星(Shooting Star)：上影线长，上方抛压需警惕")
    if a.close < a.open and b.close > b.open and b.open <= a.close and b.close >= a.open:
        patterns.append("看涨吞没(Bullish Engulfing)：空翻多动能加强")
    if a.close > a.open and b.close < b.open and b.open >= a.close and b.close <= a.open:
        patterns.append("看跌吞没(Bearish Engulfing)：多翻空动能加强")

    if len(bars) >= 3:
        x, y, z = bars[-3], bars[-2], bars[-1]
        x_body = abs(x.close - x.open)
        y_body = abs(y.close - y.open)
        if (
            x.close < x.open
            and y_body < x_body * 0.45
            and z.close > z.open
            and z.close > (x.open + x.close) / 2
        ):
            patterns.append("晨星结构(Morning Star)：潜在底部反转信号")
        if (
            x.close > x.open
            and y_body < x_body * 0.45
            and z.close < z.open
            and z.close < (x.open + x.close) / 2
        ):
            patterns.append("黄昏星结构(Evening Star)：潜在顶部反转信号")

    if a.close > 0:
        gap_pct = (b.open - a.close) / a.close * 100
        if gap_pct >= 1.0:
            patterns.append(f"向上跳空约 {gap_pct:.2f}%")
        elif gap_pct <= -1.0:
            patterns.append(f"向下跳空约 {gap_pct:.2f}%")

    return patterns


def _structure_note(closes: list[float], highs: list[float], lows: list[float]) -> str:
    if len(closes) < 6:
        return "样本偏少，结构判定可信度有限"
    swing_highs, _ = _swing_points(highs, 2, 2)
    _, swing_lows = _swing_points(lows, 2, 2)
    if len(swing_highs) >= 2 and len(swing_lows) >= 2:
        last_two_h = swing_highs[-2:]
        last_two_l = swing_lows[-2:]
        rising_h = last_two_h[1][1] > last_two_h[0][1]
        rising_l = last_two_l[1][1] > last_two_l[0][1]
        if rising_h and rising_l:
            return "波段抬高：更高高点+更高低点，偏多头结构"
        if (not rising_h) and (not rising_l):
            return "波段走低：更低高点+更低低点，偏空头结构"
        if rising_h and not rising_l:
            return "高点抬升但低点未抬升，多空分歧、结构未完全确认"
        return "低点抬升但高点未抬升，修复中的震荡结构"
    mid = len(closes) // 2
    first_avg = sum(closes[:mid]) / max(mid, 1)
    second_avg = sum(closes[mid:]) / max(len(closes) - mid, 1)
    if second_avg > first_avg * 1.01:
        return "后半程重心上移，偏多震荡或上升通道"
    if second_avg < first_avg * 0.99:
        return "后半程重心下移，偏空震荡或下降通道"
    return "区间重心大致持平，以震荡盘整为主"


def build_technical_facts(
    bars: list[Bar],
    timeframe: str,
    context_bars: list[Bar] | None = None,
) -> dict[str, Any]:
    """
    bars: K-lines inside the user-selected window (range stats / window patterns).
    context_bars: optional longer series ending at the same end (for indicators).
    """
    if not bars:
        return {
            "timeframe": timeframe,
            "barCount": 0,
            "note": "所选区间内无 K 线数据",
        }

    ctx = context_bars if context_bars and len(context_bars) >= len(bars) else bars
    # Ensure context includes the window end state
    if ctx is not bars and ctx[-1].timestamp < bars[-1].timestamp:
        ctx = bars

    first, last = bars[0], bars[-1]
    highs = [b.high for b in bars]
    lows = [b.low for b in bars]
    volumes = [b.volume for b in bars]

    # Indicator series from context (lookback + window)
    ctx_closes = [b.close for b in ctx]
    ctx_highs = [b.high for b in ctx]
    ctx_lows = [b.low for b in ctx]

    change = last.close - first.open
    change_pct = (change / first.open * 100) if first.open else 0.0
    range_high = max(highs)
    range_low = min(lows)
    range_span = max(range_high - range_low, 1e-9)
    close_pos = (last.close - range_low) / range_span * 100

    avg_vol = sum(volumes) / len(volumes) if volumes else 0.0
    # Volume ratio: last bar vs context average (more stable) when lookback exists
    ctx_avg_vol = sum(b.volume for b in ctx) / len(ctx) if ctx else avg_vol
    vol_ratio = (last.volume / ctx_avg_vol) if ctx_avg_vol else None

    ma5 = _sma(ctx_closes, 5)
    ma10 = _sma(ctx_closes, 10)
    ma20 = _sma(ctx_closes, 20)
    ma60 = _sma(ctx_closes, 60)

    ema12 = _ema_series(ctx_closes, 12)
    ema26 = _ema_series(ctx_closes, 26)
    macd_line: list[float | None] = []
    for i in range(len(ctx_closes)):
        if ema12[i] is None or ema26[i] is None:
            macd_line.append(None)
        else:
            macd_line.append(ema12[i] - ema26[i])  # type: ignore[operator]

    filled = [v if v is not None else 0.0 for v in macd_line]
    signal_series = _ema_series(filled, 9)
    macd_last = macd_line[-1] if macd_line else None
    signal_last = signal_series[-1] if signal_series else None
    hist_last = None
    if macd_last is not None and signal_last is not None:
        hist_last = macd_last - signal_last

    rsi = _rsi(ctx_closes, 14)
    atr = _atr(ctx, 14)
    atr_pct = (atr / last.close * 100) if atr and last.close else None

    bb_mid = ma20
    bb_upper = bb_lower = None
    if bb_mid is not None and len(ctx_closes) >= 20:
        sd = _std(ctx_closes[-20:])
        bb_upper = bb_mid + 2 * sd
        bb_lower = bb_mid - 2 * sd

    rets: list[float] = []
    for i in range(1, len(ctx_closes)):
        if ctx_closes[i - 1]:
            rets.append((ctx_closes[i] - ctx_closes[i - 1]) / ctx_closes[i - 1] * 100)
    vol_pct = _std(rets[-max(20, len(bars)) :]) if rets else 0.0

    up_bars = sum(1 for b in bars if b.close >= b.open)
    down_bars = len(bars) - up_bars
    streak = 1
    for i in range(len(bars) - 2, -1, -1):
        same = (bars[i].close >= bars[i].open) == (last.close >= last.open)
        if same:
            streak += 1
        else:
            break
    streak_dir = "阳线" if last.close >= last.open else "阴线"

    ma_stack = "样本不足，均线排列未定"
    present = [v for v in (ma5, ma10, ma20) if v is not None]
    if len(present) >= 2:
        if all(present[i] >= present[i + 1] for i in range(len(present) - 1)):
            ma_stack = "短期均线在上，偏多头排列"
        elif all(present[i] <= present[i + 1] for i in range(len(present) - 1)):
            ma_stack = "短期均线在下，偏空头排列"
        else:
            ma_stack = "均线缠绕/交叉，方向尚未干净"

    ma_note = ma_stack
    if ma5 is not None and ma20 is not None:
        if ma5 > ma20 * 1.005:
            ma_note = f"{ma_stack}；MA5 位于 MA20 上方"
        elif ma5 < ma20 * 0.995:
            ma_note = f"{ma_stack}；MA5 位于 MA20 下方"
        else:
            ma_note = f"{ma_stack}；MA5 与 MA20 贴近"

    rsi_note = "RSI 样本不足"
    if rsi is not None:
        if rsi >= 70:
            rsi_note = f"RSI(14)={rsi:.1f}，进入超买区，注意回吐风险"
        elif rsi <= 30:
            rsi_note = f"RSI(14)={rsi:.1f}，进入超卖区，关注反抽可能"
        elif rsi >= 55:
            rsi_note = f"RSI(14)={rsi:.1f}，动能偏多但未极端"
        elif rsi <= 45:
            rsi_note = f"RSI(14)={rsi:.1f}，动能偏弱但未极端"
        else:
            rsi_note = f"RSI(14)={rsi:.1f}，中性区间"

    macd_note = "MACD 样本不足"
    if macd_last is not None and hist_last is not None:
        side = "零轴上方" if macd_last >= 0 else "零轴下方"
        if hist_last > 0:
            hist_desc = "红柱扩张"
        elif hist_last < 0:
            hist_desc = "绿柱扩张"
        else:
            hist_desc = "柱体收敛"
        macd_note = f"MACD {side}，柱体 {hist_desc}（MACD={macd_last:.4f}, Hist={hist_last:.4f}）"

    bb_note = "布林带样本不足"
    if bb_mid is not None and bb_upper is not None and bb_lower is not None:
        if last.close >= bb_upper:
            bb_note = "收盘触及/站上布林上轨，波动扩张偏多，警惕冲高回落"
        elif last.close <= bb_lower:
            bb_note = "收盘触及/跌破布林下轨，波动扩张偏空，关注超跌修复"
        else:
            width = (bb_upper - bb_lower) / bb_mid * 100 if bb_mid else 0
            bb_note = f"价格运行于布林带中轨附近，带宽约 {width:.2f}%"

    vol_note = "成交量信息不足"
    if vol_ratio is not None:
        if vol_ratio >= 1.8:
            vol_note = f"末根量能为均量的 {vol_ratio:.2f}x，放量确认意图更强"
        elif vol_ratio <= 0.6:
            vol_note = f"末根量能为均量的 {vol_ratio:.2f}x，缩量，突破/破位可信度打折"
        else:
            vol_note = f"末根量能约均量的 {vol_ratio:.2f}x，量能中性"

    swing_h, swing_l = _swing_points(ctx_highs, 2, 2)
    resist_levels = sorted(
        {round(range_high, 4), *[round(v, 4) for _, v in swing_h[-3:]]}, reverse=True
    )[:3]
    support_levels = sorted({round(range_low, 4), *[round(v, 4) for _, v in swing_l[-3:]]})[:3]

    if change_pct >= 5:
        trend = "强势上行"
    elif change_pct >= 2:
        trend = "偏强上行"
    elif change_pct >= 0.5:
        trend = "温和上行"
    elif change_pct <= -5:
        trend = "深幅下行"
    elif change_pct <= -2:
        trend = "偏弱下行"
    elif change_pct <= -0.5:
        trend = "温和下行"
    else:
        trend = "震荡整理"

    structure = _structure_note(ctx_closes, ctx_highs, ctx_lows)
    patterns = _candle_patterns(bars if len(bars) >= 2 else ctx)

    recent_n = min(12, len(bars))
    recent_bars = [
        {
            "t": b.timestamp.isoformat(),
            "o": round(b.open, 4),
            "h": round(b.high, 4),
            "l": round(b.low, 4),
            "c": round(b.close, 4),
            "v": round(b.volume, 2),
        }
        for b in bars[-recent_n:]
    ]

    lookback_used = len(ctx) > len(bars)
    sample_note = ""
    if lookback_used:
        sample_note = (
            f"分析窗口仅 {len(bars)} 根K线；均线/RSI/MACD/布林等指标基于向前扩展的 "
            f"{len(ctx)} 根历史K线计算，避免短窗口样本不足。"
        )
    elif len(bars) < 20:
        sample_note = f"窗口与可用历史合计仅 {len(bars)} 根K线，部分中长周期指标仍可能受限。"

    return {
        "timeframe": timeframe,
        "barCount": len(bars),
        "indicatorBarCount": len(ctx),
        "lookbackUsed": lookback_used,
        "sampleNote": sample_note,
        "startTime": first.timestamp.isoformat(),
        "endTime": last.timestamp.isoformat(),
        "open": round(first.open, 4),
        "close": round(last.close, 4),
        "high": round(range_high, 4),
        "low": round(range_low, 4),
        "change": round(change, 4),
        "changePercent": round(change_pct, 3),
        "closePositionInRangePct": round(close_pos, 1),
        "avgVolume": round(avg_vol, 2),
        "lastVolume": round(last.volume, 2),
        "volumeRatioVsAvg": round(vol_ratio, 2) if vol_ratio is not None else None,
        "volumeNote": vol_note,
        "ma5": round(ma5, 4) if ma5 is not None else None,
        "ma10": round(ma10, 4) if ma10 is not None else None,
        "ma20": round(ma20, 4) if ma20 is not None else None,
        "ma60": round(ma60, 4) if ma60 is not None else None,
        "maNote": ma_note,
        "maStack": ma_stack,
        "rsi14": round(rsi, 2) if rsi is not None else None,
        "rsiNote": rsi_note,
        "macd": round(macd_last, 5) if macd_last is not None else None,
        "macdSignal": round(signal_last, 5) if signal_last is not None else None,
        "macdHist": round(hist_last, 5) if hist_last is not None else None,
        "macdNote": macd_note,
        "bollinger": {
            "mid": round(bb_mid, 4) if bb_mid is not None else None,
            "upper": round(bb_upper, 4) if bb_upper is not None else None,
            "lower": round(bb_lower, 4) if bb_lower is not None else None,
            "note": bb_note,
        },
        "atr14": round(atr, 4) if atr is not None else None,
        "atrPercent": round(atr_pct, 3) if atr_pct is not None else None,
        "returnVolatilityPct": round(vol_pct, 3),
        "upBars": up_bars,
        "downBars": down_bars,
        "candleStreak": f"连续 {streak} 根{streak_dir}",
        "structureNote": structure,
        "candlePatterns": patterns,
        "supportLevels": support_levels,
        "resistanceLevels": resist_levels,
        "trendLabel": trend,
        "recentBars": recent_bars,
        "traderChecklist": [
            sample_note,
            ma_note,
            rsi_note,
            macd_note,
            bb_note,
            vol_note,
            structure,
            *patterns[:3],
        ],
    }


def build_news_facts(items: list[NewsItem], limit: int = 25) -> dict[str, Any]:
    sliced = items[:limit]
    pos = sum(1 for i in sliced if i.direction == "positive")
    neg = sum(1 for i in sliced if i.direction == "negative")
    neu = sum(1 for i in sliced if i.direction in ("neutral", "uncertain"))
    high = sum(1 for i in sliced if i.importance == "high")

    type_mix: dict[str, int] = {}
    for i in sliced:
        key = i.event_type or "other"
        type_mix[key] = type_mix.get(key, 0) + 1

    headlines = [
        {
            "time": i.published_at.isoformat() if isinstance(i.published_at, datetime) else str(i.published_at),
            "headline": i.headline,
            "direction": i.direction,
            "importance": i.importance,
            "eventType": i.event_type,
            "summary": (i.summary_original or "")[:280],
        }
        for i in sliced
    ]
    high_impact = [h for h in headlines if h["importance"] == "high"][:8]

    if pos > neg * 1.5 and pos >= 2:
        bias = "偏利好"
    elif neg > pos * 1.5 and neg >= 2:
        bias = "偏利空"
    elif pos == neg and pos > 0:
        bias = "多空对峙"
    else:
        bias = "中性偏混杂"

    conflict = pos > 0 and neg > 0 and abs(pos - neg) <= max(1, (pos + neg) // 4)
    dominant_types = sorted(type_mix.items(), key=lambda x: -x[1])[:4]

    return {
        "newsCount": len(items),
        "sampled": len(sliced),
        "directionMix": {"positive": pos, "negative": neg, "neutralOrUncertain": neu},
        "sentimentBias": bias,
        "conflictingSignals": conflict,
        "highImportanceCount": high,
        "eventTypeMix": type_mix,
        "dominantEventTypes": [{"type": t, "count": c} for t, c in dominant_types],
        "highImpactHeadlines": high_impact,
        "headlines": headlines,
        "deskNotes": [
            f"情绪偏向：{bias}（利好 {pos} / 利空 {neg} / 中性 {neu}）",
            f"高影响条数：{high}",
            "事件类型分布："
            + ("、".join(f"{t}×{c}" for t, c in dominant_types) if dominant_types else "无"),
            "多空标题并存，需区分噪声与真催化剂" if conflict else "情绪方向相对一致",
        ],
    }
