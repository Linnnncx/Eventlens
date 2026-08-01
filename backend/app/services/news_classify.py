"""Lightweight headline classifiers used when ingesting news (no LLM required)."""

from __future__ import annotations

from typing import Literal

Direction = Literal["positive", "negative", "neutral", "uncertain"]
EventType = Literal[
    "earnings",
    "guidance",
    "product",
    "regulation",
    "analyst",
    "management",
    "macro",
    "company_update",
    "other",
]
Importance = Literal["high", "medium", "low"]


def classify_headline(headline: str, summary: str | None = None) -> tuple[EventType, Importance, Direction]:
    text = f"{headline or ''} {summary or ''}".lower()

    event_type: EventType = "company_update"
    importance: Importance = "medium"
    direction: Direction = "uncertain"

    if any(k in text for k in ("earnings", "eps", "revenue", "财报", "季报", "results")):
        event_type = "earnings"
        importance = "high"
    elif any(k in text for k in ("guidance", "outlook", "指引", "forecast")):
        event_type = "guidance"
        importance = "high"
    elif any(k in text for k in ("lawsuit", "sec", "regulation", "ban", "probe", "监管", "诉讼", "antitrust")):
        event_type = "regulation"
        direction = "negative"
        importance = "high"
    elif any(k in text for k in ("launch", "product", "gpu", "chip", "unveil", "发布", "产品")):
        event_type = "product"
    elif any(k in text for k in ("upgrade", "downgrade", "analyst", "price target", "评级", "raises target", "cuts target")):
        event_type = "analyst"
    elif any(k in text for k in ("ceo", "cfo", "appoint", "resign", "管理层")):
        event_type = "management"
    elif any(k in text for k in ("fed", "treasury", "inflation", "jobs report", "macro", "yield")):
        event_type = "macro"

    pos = (
        "beat",
        "surge",
        "soar",
        "record",
        "growth",
        "rally",
        "jump",
        "boost",
        "raises",
        "upgrade",
        "上涨",
        "超预期",
        "突破",
        "beat estimates",
    )
    neg = (
        "miss",
        "cut",
        "probe",
        "decline",
        "fall",
        "falls",
        "drop",
        "slump",
        "plunge",
        "downgrade",
        "disappoint",
        "lawsuit",
        "下跌",
        "不及预期",
        "调查",
        "sell-off",
        "selloff",
    )

    pos_hits = sum(1 for k in pos if k in text)
    neg_hits = sum(1 for k in neg if k in text)
    if pos_hits > neg_hits:
        direction = "positive"
    elif neg_hits > pos_hits:
        direction = "negative"

    if "downgrade" in text or "cuts target" in text:
        direction = "negative"
        event_type = "analyst"
    if ("upgrade" in text or "raises target" in text or "raises pt" in text) and "downgrade" not in text:
        direction = "positive"
        event_type = "analyst"

    return event_type, importance, direction
