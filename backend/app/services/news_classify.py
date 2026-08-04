"""Deterministic news classification used during ingestion.

This intentionally remains fast and explainable, but uses weighted phrases and
event context rather than the old single-keyword/default-medium heuristic.
"""

from __future__ import annotations

import re
from typing import Literal

Direction = Literal["positive", "negative", "neutral", "uncertain"]
EventType = Literal[
    "earnings", "guidance", "product", "regulation", "analyst",
    "management", "macro", "company_update", "other",
]
Importance = Literal["high", "medium", "low"]


def _contains(text: str, phrases: tuple[str, ...]) -> bool:
    return any(phrase in text for phrase in phrases)


def _score(text: str, weighted: tuple[tuple[str, int], ...]) -> int:
    return sum(weight for phrase, weight in weighted if phrase in text)


POSITIVE = (
    ("beats estimates", 4), ("beat estimates", 4), ("tops estimates", 4),
    ("raises guidance", 4), ("raises outlook", 4), ("guidance raised", 4),
    ("record revenue", 3), ("record profit", 3), ("record high", 2),
    ("earnings beat", 4), ("beats earnings", 4),
    ("approved", 3), ("approval", 2), ("wins contract", 3),
    ("share buyback", 3), ("stock buyback", 3), ("dividend increase", 3),
    ("upgrade", 3), ("upgraded", 3), ("raises price target", 3),
    ("price target raised", 3), ("strong demand", 2), ("market share gain", 2),
    ("maintains buy", 2), ("buy rating", 2), ("outperform rating", 2),
    ("accelerates growth", 2), ("profit rises", 2), ("revenue rises", 2),
    ("surges", 2), ("soars", 2), ("rallies", 2), ("jumps", 1),
    ("pops", 2), ("climbs", 2), ("rises", 1), ("gains", 1),
    ("robust", 2), ("strong earnings", 3), ("strong results", 3),
    ("bull case", 2), ("upside", 2), ("momentum", 1), ("windfall", 2),
    ("cashes in", 2), ("shoot up", 2), ("doubles down", 1), ("boost", 2),
    ("growth", 1), ("profitable", 1), ("partnership", 1), ("launches", 1),
    ("超预期", 4), ("上调指引", 4), ("获批", 3), ("中标", 3),
    ("回购", 3), ("上调目标价", 3), ("增长加速", 2), ("创纪录", 2),
    ("上涨", 1), ("突破", 1),
)

NEGATIVE = (
    ("misses estimates", 4), ("missed estimates", 4), ("below estimates", 4),
    ("earnings miss", 4), ("missed earnings", 4),
    ("cuts guidance", 4), ("lowers guidance", 4), ("withdraws guidance", 4),
    ("profit warning", 4), ("bankruptcy", 5), ("chapter 11", 5),
    ("accounting fraud", 5), ("fraud probe", 5), ("data breach", 4),
    ("sec probe", 4), ("antitrust probe", 4), ("criminal investigation", 5),
    ("recall", 3), ("offering", 2), ("dilution", 4), ("layoffs", 2),
    ("downgrade", 3), ("downgraded", 3), ("cuts price target", 3),
    ("price target cut", 3), ("loses contract", 3), ("ceo resigns", 3),
    ("cfo resigns", 3), ("revenue falls", 2), ("profit falls", 2),
    ("weak demand", 2), ("slumps", 2), ("plunges", 2), ("sell-off", 2),
    ("falls", 1), ("drops", 1), ("declines", 1), ("slips", 1), ("dips", 1),
    ("rout", 2), ("woes", 2), ("headwind", 2), ("cautious", 1),
    ("weak", 1), ("tough", 1), ("risk", 1), ("debt", 1), ("lawsuit", 2),
    ("不及预期", 4), ("下调指引", 4), ("调查", 3), ("召回", 3),
    ("稀释", 4), ("裁员", 2), ("下调目标价", 3), ("下跌", 1),
)

LOW_SIGNAL = (
    "prediction:", "prediction ", "could be", "might be", "may be",
    "is it time", "is the stock a buy", "should you buy", "should investors",
    "why this stock", "why shares", "stocks to watch", "top stocks",
    "best stocks", "what investors need to know", "here's why", "opinion",
    "technical analysis", "price prediction", "值得买入吗", "能否买入", "预测",
)

HIGH_SIGNAL = (
    "earnings", "quarterly results", "eps", "guidance", "outlook",
    "merger", "acquisition", "acquires", "takeover", "bankruptcy", "chapter 11",
    "sec probe", "antitrust", "criminal investigation", "fraud", "data breach",
    "fda approval", "fda rejects", "recall", "财报", "季报", "业绩", "指引",
    "并购", "收购", "破产", "监管调查", "获批", "召回",
)

MEDIUM_SIGNAL = (
    "launch", "unveil", "product", "partnership", "contract", "dividend", "buyback",
    "upgrade", "downgrade", "price target", "analyst", "ceo", "cfo", "appoint",
    "resign", "layoff", "fed", "inflation", "jobs report", "treasury", "yield",
    "发布", "产品", "合作", "合同", "回购", "分红", "评级", "目标价", "裁员",
)


def classify_headline(headline: str, summary: str | None = None) -> tuple[EventType, Importance, Direction]:
    title = re.sub(r"\s+", " ", (headline or "").lower()).strip()
    detail = re.sub(r"\s+", " ", (summary or "").lower()).strip()
    text = f"{title} {detail}".strip()

    if _contains(title, ("earnings", "quarterly results", "eps", "财报", "季报", "业绩")):
        event_type: EventType = "earnings"
    elif _contains(title, ("guidance", "outlook", "forecast", "指引", "业绩预告")):
        event_type = "guidance"
    elif _contains(title, ("lawsuit", "sec ", "regulation", "regulator", "ban", "probe", "antitrust", "监管", "诉讼", "调查")):
        event_type = "regulation"
    elif _contains(title, ("launch", "product", "gpu", "chip", "unveil", "发布", "产品")):
        event_type = "product"
    elif _contains(title, ("upgrade", "downgrade", "analyst", "price target", "评级", "目标价")):
        event_type = "analyst"
    elif _contains(title, ("ceo", "cfo", "appoint", "resign", "management", "管理层", "任命", "辞职")):
        event_type = "management"
    elif _contains(title, ("fed", "treasury", "inflation", "jobs report", "macro", "yield", "美联储", "通胀", "非农")):
        event_type = "macro"
    else:
        event_type = "company_update"

    # Headline signals are deliberately weighted more heavily than RSS summaries,
    # which often contain unrelated recommendation widgets or nearby headlines.
    positive = _score(title, POSITIVE) * 2 + _score(detail, POSITIVE)
    negative = _score(title, NEGATIVE) * 2 + _score(detail, NEGATIVE)

    # Broker headlines commonly encode direction as numeric target revisions
    # ("to $280 from $329") without using words such as raise/cut.
    target_revision = re.search(
        r"(?:price target|target price).*?to\s+\$?([\d,.]+)\s+from\s+\$?([\d,.]+)",
        title,
    )
    if target_revision:
        try:
            new_target = float(target_revision.group(1).replace(",", ""))
            old_target = float(target_revision.group(2).replace(",", ""))
            if new_target > old_target:
                positive += 6
            elif new_target < old_target:
                negative += 6
        except ValueError:
            pass

    # Contextual priors make concrete catalysts directional even when headlines
    # use restrained wording such as "announces buyback" or "faces SEC probe".
    if event_type == "regulation" and _contains(text, ("probe", "lawsuit", "ban", "antitrust", "investigation", "诉讼", "调查", "禁令")):
        negative += 2
    if _contains(text, ("buyback", "dividend increase", "wins contract", "approval", "回购", "中标", "获批")):
        positive += 2
    if _contains(text, ("offering", "dilution", "recall", "layoff", "稀释", "召回", "裁员")):
        negative += 2

    if positive > negative:
        direction: Direction = "positive"
    elif negative > positive:
        direction = "negative"
    elif positive == negative and positive > 0:
        direction = "uncertain"  # genuinely mixed signals, e.g. EPS beat/revenue miss
    else:
        direction = "neutral"

    high = _contains(title, HIGH_SIGNAL)
    medium = _contains(title, MEDIUM_SIGNAL)
    low_editorial = _contains(title, LOW_SIGNAL)
    magnitude = max(positive, negative)
    if high and not low_editorial:
        importance: Importance = "high"
    elif magnitude >= 4 and not low_editorial:
        importance = "high"
    elif (medium or magnitude >= 3) and not low_editorial:
        importance = "medium"
    else:
        importance = "low"

    return event_type, importance, direction
