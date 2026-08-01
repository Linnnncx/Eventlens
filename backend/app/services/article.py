"""Best-effort article body extraction.

There is no readability dependency here, so we use a small heuristic: pull the
paragraph tags out of the page and keep the ones that look like prose. Good enough
to show a readable excerpt next to the chart, and cached in SQLite so each link is
only fetched once. Google News links redirect to the publisher, which `requests`
follows automatically.
"""

from __future__ import annotations

import html
import logging
import re

from app.providers.yahoo_http import YAHOO_UA, apply_proxy_env

logger = logging.getLogger(__name__)

MAX_CHARS = 6000
MIN_PARAGRAPH_CHARS = 60

_SCRIPT_RE = re.compile(r"<(script|style|noscript|svg|figure|nav|footer|header)[^>]*>.*?</\1>", re.I | re.S)
_P_RE = re.compile(r"<p[^>]*>(.*?)</p>", re.I | re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\r\f\v]+")

# Cookie banners / paywall furniture that shows up as a "paragraph"
_BOILERPLATE = (
    "cookie",
    "subscribe",
    "sign in",
    "advertisement",
    "all rights reserved",
    "terms of service",
    "privacy policy",
    "enable javascript",
)


def _clean(fragment: str) -> str:
    text = _TAG_RE.sub(" ", fragment)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    return text.strip()


def extract_article_text(html_text: str) -> str:
    body = _SCRIPT_RE.sub(" ", html_text)
    paragraphs: list[str] = []
    seen: set[str] = set()
    for raw in _P_RE.findall(body):
        text = _clean(raw)
        if len(text) < MIN_PARAGRAPH_CHARS:
            continue
        low = text.lower()
        if any(b in low for b in _BOILERPLATE):
            continue
        if text in seen:
            continue
        seen.add(text)
        paragraphs.append(text)
        if sum(len(p) for p in paragraphs) > MAX_CHARS:
            break
    return "\n\n".join(paragraphs)[:MAX_CHARS]


def fetch_article_text(url: str) -> str:
    """Blocking fetch — call via asyncio.to_thread."""
    import requests

    apply_proxy_env()
    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": YAHOO_UA,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "en-US,en;q=0.9",
            },
            timeout=20,
            allow_redirects=True,
        )
        if resp.status_code >= 400:
            return ""
        ctype = resp.headers.get("Content-Type", "")
        if "html" not in ctype.lower():
            return ""
        resp.encoding = resp.encoding or resp.apparent_encoding
        return extract_article_text(resp.text)
    except Exception:
        logger.info("article fetch failed: %s", url, exc_info=True)
        return ""
