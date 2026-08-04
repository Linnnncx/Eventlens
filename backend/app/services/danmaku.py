from __future__ import annotations

import random
import time
import uuid
from collections import defaultdict, deque
from typing import Any

BOT_POOL = [
    ("Alpha猫", "这根量能不错"),
    ("波段手", "先看支撑再动手"),
    ("夜盘猫头鹰", "事件驱动还是看反应窗口"),
    ("网格少女", "区间震荡，别追高"),
    ("价值派老王", "波动里找确定性"),
    ("动量捕手", "突破要确认再跟"),
    ("风控小队长", "仓位先控住"),
    ("盘口侦探", "买卖盘有点挤"),
    ("复盘笔记", "和上次事件后走势有点像"),
    ("冷静交易员", "情绪上来了，反而要慢"),
    ("短线闪电", "5 分钟节奏在加快"),
    ("宏观观察员", "大盘风向也得盯着"),
]

_rooms: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=100))
_last_bot_at: dict[str, float] = defaultdict(float)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _seed_if_empty(symbol: str) -> None:
    room = _rooms[symbol]
    if room:
        return
    now = _now_ms()
    picks = random.sample(BOT_POOL, k=min(4, len(BOT_POOL)))
    for i, (nick, text) in enumerate(picks):
        room.append(
            {
                "id": str(uuid.uuid4()),
                "symbol": symbol,
                "text": text,
                "nickname": nick,
                "self": False,
                "tone": random.choice(["neutral", "up", "news", "amber"]),
                "createdAt": now - (len(picks) - i) * 1800,
            }
        )


def _maybe_inject_bot(symbol: str) -> None:
    now = time.time()
    if now - _last_bot_at[symbol] < random.uniform(2.5, 5.5):
        return
    _last_bot_at[symbol] = now
    nick, text = random.choice(BOT_POOL)
    _rooms[symbol].append(
        {
            "id": str(uuid.uuid4()),
            "symbol": symbol,
            "text": text,
            "nickname": nick,
            "self": False,
            "tone": random.choice(["neutral", "up", "news", "amber", "sky"]),
            "createdAt": _now_ms(),
        }
    )


def list_danmaku(symbol: str, after: int | None = None) -> list[dict[str, Any]]:
    symbol = symbol.upper()
    _seed_if_empty(symbol)
    _maybe_inject_bot(symbol)
    items = list(_rooms[symbol])
    if after is not None:
        items = [m for m in items if int(m["createdAt"]) > after]
    return items[-40:]


def post_danmaku(symbol: str, text: str, nickname: str | None = None) -> dict[str, Any]:
    symbol = symbol.upper()
    cleaned = " ".join((text or "").strip().split())
    if not cleaned:
        raise ValueError("弹幕不能为空")
    if len(cleaned) > 48:
        cleaned = cleaned[:48]
    msg = {
        "id": str(uuid.uuid4()),
        "symbol": symbol,
        "text": cleaned,
        "nickname": (nickname or "我").strip()[:12] or "我",
        "self": True,
        "tone": "self",
        "createdAt": _now_ms(),
    }
    _rooms[symbol].append(msg)
    return msg
