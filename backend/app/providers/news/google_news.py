"""Google News RSS — free, no API key, and the only source here that accepts an
arbitrary date range, so it can fill the whole visible candle window.

Caveat: older items often carry a date-only timestamp (07:00 GMT), so they land in
the pre-market of their own day rather than on the exact minute.
"""

from __future__ import annotations

import logging
import re
import threading
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import Any

import requests

from app.core.config import get_settings
from app.providers.yahoo_http import YAHOO_UA, apply_proxy_env, _symbol_aliases

GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"
MAX_CHUNKS = 12
MIN_CHUNK_DAYS = 2
DEFAULT_SPAN_DAYS = 7

logger = logging.getLogger(__name__)

# Hard ceiling on concurrent RSS calls across the whole process, so a burst of
# symbol switches can never fan out into hundreds of simultaneous requests.
_REQUEST_SLOTS = threading.BoundedSemaphore(8)
_TAG_RE = re.compile(r"<[^>]+>")

# 13F/ownership filing spam floods these feeds and says nothing about the company.
# These outlets publish almost nothing else, so they are dropped wholesale.
_NOISE_PUBLISHERS = (
    "marketbeat",
    "etf daily news",
    "etfdailynews",
    "defense world",
    "defenseworld",
    "cerbat gem",
    "american banking news",
    "americanbankingnews",
    "zolmax",
    "modern readers",
    "ticker report",
    "tickerreport",
    "dispatch tribunal",
    "the markets daily",
    "themarketsdaily",
    "mayfield recorder",
    "stocks register",
)

_NOISE_PATTERNS = (
    re.compile(
        r"(sells?|buys?|acquires?|purchases?|trims?|boosts?|lowers?|raises?|takes?|has|reduces?|"
        r"grows|cuts?|invests?|opens?|initiates?|establishes?|exits?|adds?|offloads?|unloads?|"
        r"liquidates?|dumps?|lessens?|lessened|makes new investment in)\b.{0,80}?"
        r"\b(shares?|stake|position|holdings?)\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(holdings?|stake|position|shares?)\b.{0,60}?\b"
        r"(boosted|raised|lowered|lessened|trimmed|cut|reduced|increased|decreased|sold|bought|"
        r"acquired|purchased|grown|largest)\b",
        re.IGNORECASE,
    ),
    re.compile(r"\b(13F|institutional (investors?|holdings?)|short interest (up|down))\b", re.IGNORECASE),
)


def _is_noise(title: str, publisher: str | None) -> bool:
    pub = (publisher or "").lower()
    if any(bad in pub for bad in _NOISE_PUBLISHERS):
        return True
    return any(p.search(title) for p in _NOISE_PATTERNS)


@lru_cache
def _session() -> requests.Session:
    apply_proxy_env()
    s = get_settings()
    session = requests.Session()
    session.headers.update({"User-Agent": YAHOO_UA, "Accept": "application/rss+xml, text/xml"})
    proxy = (s.https_proxy or s.http_proxy or "").strip()
    if proxy:
        session.proxies.update({"http": proxy, "https": proxy})
    return session


def even_sample(items: list, limit: int) -> list:
    """Downsample a list to `limit` while keeping items spread evenly across it.

    `items` is assumed newest-first; the newest and oldest are always kept so the
    full time window stays covered instead of collapsing onto the most recent days.
    """
    n = len(items)
    if limit <= 0 or n <= limit:
        return items
    step = n / limit
    picked = [items[min(n - 1, int(i * step))] for i in range(limit)]
    # de-dup by identity in case rounding picked the same index twice
    out, seen = [], set()
    for it in picked:
        if id(it) in seen:
            continue
        seen.add(id(it))
        out.append(it)
    return out


def _strip_html(text: str) -> str:
    return _TAG_RE.sub(" ", text).replace("&nbsp;", " ").strip()


def _split_title(title: str) -> tuple[str, str | None]:
    """Google appends ' - Publisher' to every headline."""
    if " - " in title:
        head, _, tail = title.rpartition(" - ")
        if head and len(tail) <= 40:
            return head.strip(), tail.strip()
    return title.strip(), None


def _query(symbol: str, company_name: str | None) -> str:
    parts = [symbol.upper()]
    if company_name:
        parts.append(f'"{company_name.split(",")[0].strip()}"')
    parts.append("stock")
    return " ".join(parts)


def _fetch_window(query: str, after: datetime | None, before: datetime | None) -> list[dict[str, Any]]:
    q = query
    if after:
        q += f" after:{after.strftime('%Y-%m-%d')}"
    if before:
        q += f" before:{before.strftime('%Y-%m-%d')}"
    try:
        with _REQUEST_SLOTS:
            resp = _session().get(
                GOOGLE_NEWS_RSS,
                params={"q": q, "hl": "en-US", "gl": "US", "ceid": "US:en"},
                timeout=25,
            )
        if resp.status_code in (429, 503):
            logger.warning("Google News throttled us (%s) — skipping window", resp.status_code)
            return []
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception:
        return []

    out: list[dict[str, Any]] = []
    for node in root.findall(".//item"):
        raw_title = (node.findtext("title") or "").strip()
        if not raw_title:
            continue
        headline, publisher = _split_title(raw_title)
        pub_raw = node.findtext("pubDate")
        try:
            published = parsedate_to_datetime(pub_raw) if pub_raw else None
        except Exception:
            published = None
        if published is None:
            continue
        if published.tzinfo is None:
            published = published.replace(tzinfo=timezone.utc)
        source_node = node.find("source")
        if source_node is not None and (source_node.text or "").strip():
            publisher = source_node.text.strip()
        out.append(
            {
                "title": headline,
                "link": (node.findtext("link") or "").strip() or None,
                "publishedAt": published.astimezone(timezone.utc),
                "publisher": publisher or "Google News",
                "summary": _strip_html(node.findtext("description") or "") or None,
            }
        )
    return out


def fetch_google_news(
    symbol: str,
    company_name: str | None,
    start: datetime | None,
    end: datetime | None,
    limit: int = 300,
) -> list[dict[str, Any]]:
    """Slice the window into weekly chunks — each RSS query caps out around 100 items."""
    symbol = symbol.upper()
    query = _query(symbol, company_name)
    now = datetime.now(timezone.utc)
    end_dt = min(end or now, now)
    start_dt = start or (end_dt - timedelta(days=DEFAULT_SPAN_DAYS))
    if start_dt >= end_dt:
        start_dt = end_dt - timedelta(days=1)

    # Each RSS query caps out near 100 items, so slice the span into as many
    # windows as the budget allows — narrow slices for intraday, wide for daily charts.
    span_days = max(1, (end_dt - start_dt).days)
    chunk_days = max(MIN_CHUNK_DAYS, -(-span_days // MAX_CHUNKS))

    windows: list[tuple[datetime | None, datetime | None]] = [(None, None)]  # freshest, undated
    cursor = end_dt
    while cursor > start_dt and len(windows) <= MAX_CHUNKS:
        chunk_start = max(start_dt, cursor - timedelta(days=chunk_days))
        # Google's before/after are exclusive day bounds
        windows.append((chunk_start - timedelta(days=1), cursor + timedelta(days=1)))
        cursor = chunk_start

    # Fetch every window in parallel — latency is bound by the slowest single query
    with ThreadPoolExecutor(max_workers=max(1, len(windows))) as pool:
        batches = list(pool.map(lambda w: _fetch_window(query, w[0], w[1]), windows))

    aliases = _symbol_aliases(symbol, company_name)
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for batch in batches:
        for raw in batch:
            if _is_noise(raw["title"], raw.get("publisher")):
                continue
            blob = f"{raw['title']} {raw.get('summary') or ''}".lower()
            if not any(a in blob for a in aliases):
                continue
            published = raw["publishedAt"]
            if start and published < start - timedelta(days=1):
                continue
            if end and published > end + timedelta(days=1):
                continue
            key = re.sub(r"[^a-z0-9]+", "", raw["title"].lower())[:120]
            if key in seen:
                continue
            seen.add(key)
            merged.append(raw)

    # Keep coverage across the WHOLE window: sort newest-first, then, if over budget,
    # sample evenly so the oldest bars still get news instead of dropping them.
    merged.sort(key=lambda r: r["publishedAt"], reverse=True)
    return even_sample(merged, limit)
