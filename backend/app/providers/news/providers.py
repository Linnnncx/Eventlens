from __future__ import annotations

import asyncio
import re
from datetime import datetime, timedelta, timezone
from typing import Any

import yfinance as yf

from app.providers.base import ProviderUnavailable
from app.providers.market.fixture_provider import FixtureNewsProvider, content_hash, parse_dt
from app.providers.yahoo_http import company_name_for
from app.schemas.market import NewsItem
from app.services.news_classify import classify_headline


def _safe_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _extract_image_url(raw: dict, content: dict) -> str | None:
    candidates: list[Any] = []
    thumb = content.get("thumbnail") or raw.get("thumbnail")
    if isinstance(thumb, dict):
        resolutions = thumb.get("resolutions") or []
        if isinstance(resolutions, list):
            candidates.extend(resolutions)
        if thumb.get("originalUrl"):
            return str(thumb["originalUrl"])
        if thumb.get("url"):
            return str(thumb["url"])
    elif isinstance(thumb, str) and thumb.startswith("http"):
        return thumb
    for res in candidates:
        if isinstance(res, dict) and res.get("url"):
            return str(res["url"])
    return None


class YFinanceNewsProvider:
    name = "yfinance"

    def __init__(self) -> None:
        self._fallback = FixtureNewsProvider()
        from app.providers.yahoo_http import apply_proxy_env

        apply_proxy_env()

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        symbol = symbol.upper()

        def _fetch() -> list[NewsItem]:
            from app.providers.yahoo_http import fetch_symbol_news

            items: list[NewsItem] = []
            seen: set[str] = set()
            company = company_name_for(symbol)
            try:
                raw_list = fetch_symbol_news(symbol, company_name=company, limit=max(limit, 40))
            except Exception:
                raw_list = []

            if len(raw_list) < 5:
                try:
                    t = yf.Ticker(symbol)
                    extra = getattr(t, "news", None) or []
                    raw_list = list(raw_list) + list(extra)
                except Exception:
                    pass

            for raw in raw_list:
                try:
                    if not isinstance(raw, dict):
                        continue
                    content = raw.get("content") if isinstance(raw.get("content"), dict) else raw
                    if not isinstance(content, dict):
                        content = raw
                    headline = _safe_str(
                        content.get("title")
                        or raw.get("title")
                        or content.get("headline")
                        or "Untitled"
                    )
                    url = None
                    click = content.get("clickThroughUrl") or content.get("canonicalUrl") or {}
                    if isinstance(click, dict):
                        url = click.get("url")
                    url = url or raw.get("link") or raw.get("url")
                    pub = (
                        content.get("pubDate")
                        or content.get("displayTime")
                        or raw.get("providerPublishTime")
                    )
                    if isinstance(pub, (int, float)):
                        published = datetime.utcfromtimestamp(pub).replace(
                            tzinfo=__import__("datetime").timezone.utc
                        )
                    else:
                        published = parse_dt(pub or datetime.utcnow())
                    source = _safe_str(
                        (content.get("provider") or {}).get("displayName")
                        if isinstance(content.get("provider"), dict)
                        else raw.get("publisher") or "Yahoo Finance"
                    )
                    summary = _safe_str(content.get("summary") or raw.get("summary") or None) or None
                    image_url = _extract_image_url(raw, content)
                    thumb = raw.get("thumbnail")
                    if not image_url and isinstance(thumb, dict):
                        resolutions = thumb.get("resolutions") or []
                        if resolutions and isinstance(resolutions[0], dict):
                            image_url = resolutions[0].get("url")
                    h = content_hash(headline, url, published.isoformat())
                    if h in seen:
                        continue
                    seen.add(h)
                    if start and published < start:
                        continue
                    if end and published > end:
                        continue
                    event_type, importance, direction = classify_headline(headline, summary)
                    items.append(
                        NewsItem(
                            id=f"yf_{symbol.lower()}_{h}",
                            headline=headline,
                            summaryOriginal=summary,
                            summaryAi=None,
                            source=source,
                            url=url,
                            imageUrl=image_url,
                            publishedAt=published,
                            symbols=[symbol],
                            eventType=event_type,
                            importance=importance,
                            direction=direction,
                            timeHorizon="short_term",
                            provider=self.name,
                        )
                    )
                    if len(items) >= limit:
                        break
                except Exception:
                    continue
            return items

        try:
            items = await asyncio.to_thread(_fetch)
            if not items:
                return await self._fallback.get_news(symbol, start, end, limit)
            return items
        except Exception:
            return await self._fallback.get_news(symbol, start, end, limit)


class AlpacaNewsProvider:
    name = "alpaca"

    def __init__(self) -> None:
        from app.core.config import get_settings

        self.settings = get_settings()

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        if not self.settings.alpaca_configured:
            raise ProviderUnavailable(self.name, "ALPACA_API_KEY/SECRET not configured")
        import httpx

        headers = {
            "APCA-API-KEY-ID": self.settings.alpaca_api_key,
            "APCA-API-SECRET-KEY": self.settings.alpaca_api_secret,
        }
        params: dict[str, Any] = {"symbols": symbol.upper(), "limit": limit}
        if start:
            params["start"] = start.isoformat().replace("+00:00", "Z")
        if end:
            params["end"] = end.isoformat().replace("+00:00", "Z")
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.get("https://data.alpaca.markets/v1beta1/news", params=params, headers=headers)
            if resp.status_code >= 400:
                raise ProviderUnavailable(self.name, resp.text)
            data = resp.json()
        out: list[NewsItem] = []
        for raw in data.get("news") or []:
            published = parse_dt(raw.get("created_at") or raw.get("updated_at"))
            headline = raw.get("headline") or "Untitled"
            url = raw.get("url")
            h = content_hash(headline, url, published.isoformat())
            summary = raw.get("summary")
            event_type, importance, direction = classify_headline(headline, summary)
            out.append(
                NewsItem(
                    id=f"alp_{raw.get('id', h)}",
                    headline=headline,
                    summaryOriginal=summary,
                    source=raw.get("source") or "Alpaca",
                    url=url,
                    publishedAt=published,
                    symbols=raw.get("symbols") or [symbol.upper()],
                    eventType=event_type,
                    importance=importance,
                    direction=direction,
                    timeHorizon="short_term",
                    provider=self.name,
                )
            )
        return out


class FinnhubNewsProvider:
    """Company news with an explicit date range — the only free source that covers
    the whole chart window (Yahoo only returns the last day or two).

    Free key: https://finnhub.io (company-news endpoint).
    """

    name = "finnhub"

    def __init__(self) -> None:
        from app.core.config import get_settings

        self.settings = get_settings()
        self._yf = YFinanceNewsProvider()
        self._fixture = FixtureNewsProvider()

    @property
    def configured(self) -> bool:
        return self.settings.finnhub_configured

    async def fetch_range(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        """Raw Finnhub fetch — returns [] instead of falling back, so callers can merge."""
        if not self.configured:
            return []

        import httpx

        symbol = symbol.upper()
        now = datetime.now(timezone.utc)
        end_dt = end or now
        start_dt = start or (end_dt - timedelta(days=30))
        params = {
            "symbol": symbol,
            "from": start_dt.strftime("%Y-%m-%d"),
            "to": end_dt.strftime("%Y-%m-%d"),
            "token": self.settings.finnhub_api_key,
        }
        try:
            async with httpx.AsyncClient(timeout=25) as client:
                resp = await client.get("https://finnhub.io/api/v1/company-news", params=params)
            if resp.status_code >= 400:
                raise ProviderUnavailable(self.name, resp.text)
            raw_list = resp.json()
            if not isinstance(raw_list, list):
                return []
        except Exception:
            return []

        out: list[NewsItem] = []
        seen: set[str] = set()
        for raw in raw_list:
            if not isinstance(raw, dict):
                continue
            try:
                headline = _safe_str(raw.get("headline") or "Untitled")
                url = raw.get("url")
                ts = raw.get("datetime")
                if isinstance(ts, (int, float)):
                    published = datetime.fromtimestamp(ts, tz=timezone.utc)
                else:
                    published = parse_dt(ts or now)
                if start and published < start:
                    continue
                if end and published > end:
                    continue
                h = content_hash(headline, url, published.isoformat())
                if h in seen:
                    continue
                seen.add(h)
                image = raw.get("image")
                summary = _safe_str(raw.get("summary") or None) or None
                event_type, importance, direction = classify_headline(headline, summary)
                out.append(
                    NewsItem(
                        id=f"fh_{symbol.lower()}_{h}",
                        headline=headline,
                        summaryOriginal=summary,
                        source=_safe_str(raw.get("source") or "Finnhub"),
                        url=url,
                        imageUrl=str(image) if image else None,
                        publishedAt=published,
                        symbols=[symbol],
                        eventType=event_type,
                        importance=importance,
                        direction=direction,
                        timeHorizon="short_term",
                        provider=self.name,
                    )
                )
                if len(out) >= limit:
                    break
            except Exception:
                continue
        return out

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        items = await self.fetch_range(symbol, start, end, limit)
        if items:
            return items
        items = await self._yf.get_news(symbol, start, end, limit)
        return items or await self._fixture.get_news(symbol, start, end, limit)


class GoogleNewsProvider:
    """Google News RSS — no API key and supports arbitrary date ranges."""

    name = "google"

    async def fetch_range(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        from app.providers.news.google_news import fetch_google_news

        symbol = symbol.upper()

        def _fetch() -> list[dict[str, Any]]:
            return fetch_google_news(symbol, company_name_for(symbol), start, end, limit)

        try:
            raw_list = await asyncio.to_thread(_fetch)
        except Exception:
            return []

        out: list[NewsItem] = []
        for raw in raw_list:
            try:
                headline = _safe_str(raw.get("title") or "Untitled")
                url = raw.get("link")
                published = raw["publishedAt"]
                summary = raw.get("summary")
                h = content_hash(headline, url, published.isoformat())
                event_type, importance, direction = classify_headline(headline, summary)
                out.append(
                    NewsItem(
                        id=f"gn_{symbol.lower()}_{h}",
                        headline=headline,
                        summaryOriginal=summary,
                        source=_safe_str(raw.get("publisher") or "Google News"),
                        url=url,
                        publishedAt=published,
                        symbols=[symbol],
                        eventType=event_type,
                        importance=importance,
                        direction=direction,
                        timeHorizon="short_term",
                        provider=self.name,
                    )
                )
            except Exception:
                continue
        return out


def _dedupe_key(item: NewsItem) -> str:
    return re.sub(r"[^a-z0-9]+", "", (item.headline or "").lower())[:120]


class MergedNewsProvider:
    """Finnhub + Google News (both cover a date range) + Yahoo (freshest), de-duplicated.

    Gives full coverage across the visible K-line window instead of only the last day.
    """

    name = "merged"

    def __init__(self) -> None:
        self._finnhub = FinnhubNewsProvider()
        self._google = GoogleNewsProvider()
        self._yf = YFinanceNewsProvider()
        self._fixture = FixtureNewsProvider()

    async def get_news(
        self,
        symbol: str,
        start: datetime | None,
        end: datetime | None,
        limit: int,
    ) -> list[NewsItem]:
        symbol = symbol.upper()

        results = await asyncio.gather(
            self._yf.get_news(symbol, start, end, min(limit, 60)),
            self._finnhub.fetch_range(symbol, start, end, limit),
            self._google.fetch_range(symbol, start, end, limit),
            return_exceptions=True,
        )

        merged: list[NewsItem] = []
        seen: set[str] = set()
        for res in results:
            if not isinstance(res, list):
                continue
            for item in res:
                if item.provider == "fixture":
                    continue
                key = _dedupe_key(item)
                if key in seen:
                    continue
                seen.add(key)
                if start and item.published_at < start:
                    continue
                if end and item.published_at > end:
                    continue
                merged.append(item)

        if not merged:
            return await self._fixture.get_news(symbol, start, end, limit)

        from app.providers.news.google_news import even_sample

        merged.sort(key=lambda i: i.published_at, reverse=True)
        return even_sample(merged, limit)
