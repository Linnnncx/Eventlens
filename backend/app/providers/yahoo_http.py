"""Yahoo Finance HTTP helpers that respect local proxy (Clash/V2Ray) and browser UA.

Windows system proxy is NOT used by Python automatically. EventLens reads HTTP(S)_PROXY
from settings/.env so traffic goes through e.g. 127.0.0.1:7890.
"""

from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import Any

import requests

from app.core.config import get_settings

YAHOO_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def apply_proxy_env() -> str | None:
    """Push configured proxy into process env for libraries that honor it."""
    s = get_settings()
    proxy = (s.https_proxy or s.http_proxy or "").strip()
    if not proxy:
        return None
    for key in ("HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy", "ALL_PROXY"):
        # Don't overwrite if user already exported a proxy in the shell
        if not __import__("os").environ.get(key):
            __import__("os").environ[key] = proxy
    return proxy


@lru_cache
def yahoo_session() -> requests.Session:
    apply_proxy_env()
    s = get_settings()
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": YAHOO_UA,
            "Accept": "application/json,text/plain,*/*",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    proxy = (s.https_proxy or s.http_proxy or "").strip()
    if proxy:
        session.proxies.update({"http": proxy, "https": proxy})
    return session


def yahoo_get(url: str, params: dict[str, Any] | None = None, timeout: float | None = None) -> requests.Response:
    s = get_settings()
    t = timeout if timeout is not None else float(s.yfinance_request_timeout)
    resp = yahoo_session().get(url, params=params, timeout=t)
    resp.raise_for_status()
    return resp


def fetch_chart(
    symbol: str,
    *,
    interval: str,
    period1: datetime | None = None,
    period2: datetime | None = None,
    range_: str | None = None,
) -> dict[str, Any]:
    symbol = symbol.upper()
    params: dict[str, Any] = {
        "interval": interval,
        # US equities: regular session only (not 24h). Extended hours confuse Min/Hour charts.
        "includePrePost": "false",
        "events": "div,splits",
    }
    if range_:
        params["range"] = range_
    else:
        end = period2 or datetime.now(timezone.utc)
        start = period1 or end
        params["period1"] = int(start.timestamp())
        params["period2"] = int(end.timestamp())

    resp = yahoo_get(f"https://query2.finance.yahoo.com/v8/finance/chart/{symbol}", params=params)
    data = resp.json()
    result = (data.get("chart") or {}).get("result") or []
    if not result:
        err = (data.get("chart") or {}).get("error")
        raise RuntimeError(f"Yahoo chart empty for {symbol}: {err}")
    return result[0]


def chart_to_ohlcv(result: dict[str, Any]) -> list[dict[str, Any]]:
    timestamps = result.get("timestamp") or []
    indicators = (result.get("indicators") or {}).get("quote") or [{}]
    quote = indicators[0] if indicators else {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []
    rows: list[dict[str, Any]] = []
    for i, ts in enumerate(timestamps):
        c = closes[i] if i < len(closes) else None
        if c is None:
            continue
        rows.append(
            {
                "timestamp": datetime.fromtimestamp(ts, tz=timezone.utc),
                "open": float(opens[i] if i < len(opens) and opens[i] is not None else c),
                "high": float(highs[i] if i < len(highs) and highs[i] is not None else c),
                "low": float(lows[i] if i < len(lows) and lows[i] is not None else c),
                "close": float(c),
                "volume": float(volumes[i] if i < len(volumes) and volumes[i] is not None else 0),
            }
        )
    return rows


def fetch_search_news(query: str, limit: int = 30) -> list[dict[str, Any]]:
    resp = yahoo_get(
        "https://query2.finance.yahoo.com/v1/finance/search",
        params={"q": query, "quotesCount": 1, "newsCount": min(max(limit, 10), 40)},
    )
    data = resp.json()
    return list(data.get("news") or [])[:limit]


def fetch_rss_news(symbol: str, limit: int = 40) -> list[dict[str, Any]]:
    """Yahoo Finance headline RSS — usually denser than search alone."""
    symbol = symbol.upper()
    url = "https://feeds.finance.yahoo.com/rss/2.0/headline"
    try:
        resp = yahoo_get(url, params={"s": symbol, "region": "US", "lang": "en-US"})
    except Exception:
        return []
    try:
        root = ET.fromstring(resp.content)
    except ET.ParseError:
        return []

    items: list[dict[str, Any]] = []
    for item in root.findall("./channel/item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub = (item.findtext("pubDate") or "").strip()
        desc = (item.findtext("description") or "").strip()
        # strip simple HTML
        desc = re.sub(r"<[^>]+>", "", desc).strip()
        published_ts: int | None = None
        if pub:
            try:
                published_ts = int(parsedate_to_datetime(pub).timestamp())
            except Exception:
                published_ts = None
        items.append(
            {
                "title": title,
                "link": link,
                "publisher": "Yahoo Finance",
                "providerPublishTime": published_ts,
                "summary": desc or None,
                "type": "STORY",
            }
        )
        if len(items) >= limit:
            break
    return items


def fetch_symbol_news(symbol: str, company_name: str | None = None, limit: int = 50) -> list[dict[str, Any]]:
    """Merge RSS (symbol-specific) + filtered search queries."""
    symbol = symbol.upper()
    aliases = _symbol_aliases(symbol, company_name)

    merged: list[dict[str, Any]] = []
    seen: set[str] = set()

    def _key(raw: dict[str, Any]) -> str:
        title = str(raw.get("title") or "").strip().lower()
        link = str(raw.get("link") or raw.get("url") or "").strip().lower()
        return f"{title}|{link}"

    def _add(raw: dict[str, Any], *, require_relevance: bool) -> None:
        if not isinstance(raw, dict):
            return
        k = _key(raw)
        if not k or k in seen:
            return
        if require_relevance and not _is_symbol_relevant(raw, symbol, aliases):
            return
        seen.add(k)
        merged.append(raw)

    # RSS first — prefer items that mention this ticker/aliases; fall back if too sparse
    try:
        rss_raw = fetch_rss_news(symbol, limit=min(40, limit))
        rss_relevant = [r for r in rss_raw if _is_symbol_relevant(r, symbol, aliases)]
        for raw in rss_relevant if len(rss_relevant) >= 2 else rss_raw:
            _add(raw, require_relevance=False)
    except Exception:
        pass

    queries = [symbol, f"{symbol} stock"]
    if company_name:
        # Use first distinctive token, e.g. "Meta" from "Meta Platforms Inc"
        token = next(
            (
                p
                for p in company_name.replace(",", " ").split()
                if len(p) > 2 and p.lower() not in {"inc", "corp", "ltd", "the", "class", "ordinary", "holdings"}
            ),
            None,
        )
        if token:
            queries.append(token)

    for q in queries:
        try:
            for raw in fetch_search_news(q, limit=min(25, limit)):
                _add(raw if isinstance(raw, dict) else {}, require_relevance=True)
        except Exception:
            continue

    return merged[:limit]


_TICKER_ALIASES: dict[str, list[str]] = {
    "AAPL": ["apple", "iphone", "ipad", "tim cook"],
    "META": ["meta", "facebook", "zuckerberg", "instagram", "whatsapp", "llama"],
    "NVDA": ["nvidia", "jensen", "cuda", "geforce", "blackwell"],
    "TSLA": ["tesla", "elon", "musk", "cybertruck", "fsd"],
    "MSFT": ["microsoft", "azure", "satya", "openai", "copilot", "xbox"],
    "AMZN": ["amazon", "aws", "bezos", "prime"],
    "GOOGL": ["google", "alphabet", "youtube", "gemini"],
    "GOOG": ["google", "alphabet", "youtube", "gemini"],
}


def _symbol_aliases(symbol: str, company_name: str | None) -> list[str]:
    aliases = [symbol.lower(), f"${symbol.lower()}"]
    aliases.extend(_TICKER_ALIASES.get(symbol.upper(), []))
    if company_name:
        for p in company_name.replace(",", " ").split():
            pl = p.lower()
            if len(pl) > 2 and pl not in {"inc", "corp", "ltd", "the", "class", "ordinary", "holdings", "company"}:
                aliases.append(pl)
    # unique preserve order
    out: list[str] = []
    for a in aliases:
        if a not in out:
            out.append(a)
    return out


def _is_symbol_relevant(raw: dict[str, Any], symbol: str, aliases: list[str]) -> bool:
    title = str(raw.get("title") or "")
    summary = str(raw.get("summary") or raw.get("description") or "")
    link = str(raw.get("link") or raw.get("url") or "")
    blob = f"{title} {summary} {link}".lower()
    return any(a in blob for a in aliases)
