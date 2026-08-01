"""Expand fixture news so demo charts show denser event bubbles within K-line window."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NEWS_PATH = ROOT / "data" / "fixtures" / "news.json"

# Match fixture bar anchor (generate_fixture_bars ends ~ 2026-07-30 20:00 UTC)
WINDOW_END = datetime(2026, 7, 30, 20, 0, tzinfo=timezone.utc)
WINDOW_START = WINDOW_END - timedelta(hours=30)

TEMPLATES = {
    "NVDA": [
        ("product", "high", "positive", "NVIDIA unveils Blackwell Ultra GPU; cloud partners commit day-one capacity"),
        ("earnings", "high", "positive", "NVIDIA Q2 crush: data-center revenue jumps on AI training demand"),
        ("analyst", "medium", "positive", "Morgan Stanley lifts NVDA target citing multi-year AI capex cycle"),
        ("regulation", "medium", "negative", "US export review expands scrutiny on advanced AI chip shipments"),
        ("product", "medium", "positive", "CUDA 13 preview adds new inference kernels for enterprise LLMs"),
        ("guidance", "high", "positive", "NVIDIA raises full-year guidance after hyperscaler pull-forward orders"),
        ("management", "low", "neutral", "NVIDIA appoints new VP of enterprise software partnerships"),
        ("macro", "medium", "uncertain", "Chip stocks swing as Treasury yields jump into the close"),
        ("analyst", "medium", "positive", "Bank of America reiterates Buy on NVDA after channel checks"),
        ("product", "medium", "positive", "NVIDIA partners with major OEM on liquid-cooled rack reference design"),
        ("legal", "low", "negative", "Patent suit filed against NVIDIA over GPU scheduling claims"),
        ("company_update", "medium", "positive", "NVIDIA announces $500M AI research grants for universities"),
        ("earnings", "medium", "positive", "Preliminary margin commentary points to another sequential beat"),
        ("regulation", "high", "negative", "China customers delay orders amid license uncertainty"),
        ("product", "low", "positive", "GeForce Studio drivers optimize new creator apps"),
        ("macro", "medium", "uncertain", "Semiconductor ETF inflows accelerate ahead of FOMC"),
        ("analyst", "low", "positive", "Citi adds NVDA to focus list on inference upside"),
        ("company_update", "medium", "neutral", "NVIDIA schedules AI developer conference keynote replay"),
    ],
    "AAPL": [
        ("earnings", "high", "positive", "Apple beats estimates as Services hits a new record"),
        ("analyst", "medium", "positive", "Goldman raises AAPL target on AI device upgrade cycle"),
        ("regulation", "medium", "negative", "EU opens App Store fee structure review"),
        ("product", "medium", "positive", "Vision Pro 2 rumored with lighter frame for fall event"),
        ("product", "low", "neutral", "Foxconn confirms steady iPhone production ramp"),
        ("analyst", "medium", "negative", "Morgan Stanley trims China smartphone assumptions"),
        ("guidance", "high", "positive", "Apple signals stronger Services growth into holiday quarter"),
        ("macro", "medium", "uncertain", "Consumer discretionary names mixed after retail data"),
        ("management", "low", "neutral", "Apple retail leadership role expands in Asia-Pacific"),
        ("product", "medium", "positive", "iOS beta adds on-device AI writing tools"),
        ("legal", "medium", "negative", "Antitrust plaintiffs seek additional App Store discovery"),
        ("company_update", "low", "positive", "Apple increases supplier diversification in India"),
        ("analyst", "medium", "positive", "JPMorgan sees upside to wearables attach rates"),
        ("product", "high", "positive", "New MacBook lineup leaks point to higher ASP mix"),
        ("macro", "low", "uncertain", "USD strength weighs on multinational tech names"),
        ("earnings", "medium", "positive", "Preliminary China sell-through improves week over week"),
    ],
    "TSLA": [
        ("earnings", "high", "positive", "Tesla delivery beat lifts shares in after-hours trade"),
        ("product", "medium", "positive", "Cybertruck production cadence improves at Austin plant"),
        ("regulation", "medium", "negative", "NHTSA opens inquiry into Autopilot incident cluster"),
        ("analyst", "medium", "uncertain", "Street splits on robotaxi timeline assumptions"),
        ("guidance", "high", "positive", "Tesla reiterates energy storage growth targets"),
        ("macro", "medium", "negative", "EV peers sell off as rate-cut odds slip"),
        ("product", "low", "positive", "New software update improves FSD highway handling"),
        ("management", "medium", "neutral", "Tesla IR hosts virtual battery day Q&A"),
        ("company_update", "medium", "positive", "Megapack bookings rise with utility customers"),
        ("legal", "low", "negative", "Investor suit alleges delayed Autopilot disclosures"),
        ("analyst", "medium", "positive", "Wedbush boosts TSLA PT on energy segment mix"),
        ("product", "medium", "positive", "Semi truck pilot expands with logistics partner"),
        ("macro", "low", "uncertain", "Lithium prices stabilize after multi-week slide"),
        ("earnings", "medium", "positive", "Auto margins stabilize sequentially, CFO says"),
    ],
    "MSFT": [
        ("earnings", "high", "positive", "Azure growth re-accelerates on AI workload demand"),
        ("product", "medium", "positive", "Microsoft expands Copilot seats for enterprise SKUs"),
        ("analyst", "medium", "positive", "Bernstein raises MSFT target on cloud mix shift"),
        ("regulation", "medium", "uncertain", "EU continues review of cloud licensing practices"),
        ("guidance", "high", "positive", "Microsoft lifts capex outlook for AI infrastructure"),
        ("macro", "low", "uncertain", "Mega-cap tech tracks Nasdaq futures overnight"),
        ("product", "medium", "positive", "GitHub Copilot usage doubles among Fortune 500"),
        ("company_update", "low", "neutral", "Microsoft schedules Ignite keynote lineup"),
        ("legal", "low", "negative", "Activision-related residual claims persist in court"),
        ("analyst", "medium", "positive", "Barclays sees upside to Office commercial ARPU"),
        ("product", "medium", "positive", "Windows AI features expand to more OEM devices"),
        ("management", "low", "neutral", "Microsoft cloud sales org realigns by industry"),
        ("earnings", "medium", "positive", "LinkedIn ads recover faster than expected"),
        ("macro", "medium", "uncertain", "Software peers mixed into month-end rebalance"),
    ],
    "META": [
        ("earnings", "high", "positive", "Meta ad revenue surge driven by Reels monetization"),
        ("product", "medium", "positive", "Llama model update improves multimodal benchmarks"),
        ("analyst", "medium", "positive", "Deutsche Bank upgrades META on efficiency gains"),
        ("regulation", "high", "negative", "New state privacy bills target targeted advertising"),
        ("guidance", "medium", "positive", "Meta reiterates Reality Labs spend discipline"),
        ("macro", "medium", "uncertain", "Ad platforms track consumer spending surprise"),
        ("product", "low", "positive", "Instagram tests AI shopping assistants in US"),
        ("company_update", "medium", "neutral", "Meta opens new AI research hub hiring round"),
        ("legal", "medium", "negative", "FTC continues scrutiny of youth safety practices"),
        ("analyst", "medium", "positive", "RBC cites operating leverage into H2"),
        ("product", "medium", "positive", "WhatsApp business API volumes hit new highs"),
        ("earnings", "medium", "positive", "Family of Apps DAU growth remains resilient"),
        ("macro", "low", "uncertain", "Social ad peers diverge after retail prints"),
        ("management", "low", "neutral", "Meta CFO to speak at media conference"),
    ],
}


def build_items(symbol: str) -> list[dict]:
    templates = TEMPLATES[symbol]
    n = len(templates)
    span = (WINDOW_END - WINDOW_START).total_seconds()
    items: list[dict] = []
    for i, (event_type, importance, direction, headline) in enumerate(templates):
        # Spread across window, denser near the end (recent news)
        frac = (i / max(n - 1, 1)) ** 0.85
        ts = WINDOW_START + timedelta(seconds=span * frac)
        # slight intra-hour offsets so 5Min alignment differs
        ts = ts + timedelta(minutes=(i * 7) % 50)
        nid = f"{symbol.lower()}_news_{i + 1}"
        items.append(
            {
                "id": nid,
                "headline": headline,
                "summaryOriginal": f"{headline}. Fixture demo article for EventLens chart bubbles.",
                "summaryAi": None,
                "source": "Fixture Wire",
                "url": f"https://example.com/{nid}",
                "publishedAt": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "symbols": [symbol],
                "eventType": event_type,
                "importance": importance,
                "direction": direction,
                "timeHorizon": "short_term",
                "provider": "fixture",
                "imageUrl": f"https://picsum.photos/seed/{nid}/640/360"
                if importance in {"high", "medium"} or i % 3 == 0
                else None,
            }
        )
    return items


def main() -> None:
    data = {sym: build_items(sym) for sym in TEMPLATES}
    NEWS_PATH.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    total = sum(len(v) for v in data.values())
    print(f"wrote {total} fixture news items across {len(data)} symbols -> {NEWS_PATH}")


if __name__ == "__main__":
    main()
