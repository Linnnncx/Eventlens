from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware

from app.api.routes import router
from app.core.config import get_settings
from app.database.session import WatchlistRow, init_db, SessionLocal
from app.providers.factory import provider_factory
from app.providers.yahoo_http import apply_proxy_env
from app.services.trading import ensure_portfolio
from app.services.market_hub import get_shared_quote, prime_shared_quotes


class ConnectionManager:
    def __init__(self) -> None:
        self.active: list[WebSocket] = []
        self.subscriptions: dict[WebSocket, set[str]] = {}

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active.append(websocket)
        self.subscriptions[websocket] = set()

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active:
            self.active.remove(websocket)
        self.subscriptions.pop(websocket, None)

    async def send(self, websocket: WebSocket, data: dict) -> None:
        await websocket.send_text(json.dumps(data))


manager = ConnectionManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    proxy = apply_proxy_env()
    Path("data").mkdir(parents=True, exist_ok=True)
    Path(settings.yfinance_cache_dir).mkdir(parents=True, exist_ok=True)
    init_db()
    db = SessionLocal()
    try:
        ensure_portfolio(db)
        if not db.query(WatchlistRow).first():
            from datetime import datetime, timezone

            for sym in ["AAPL", "NVDA", "TSLA", "MSFT", "META"]:
                db.add(WatchlistRow(symbol=sym, created_at=datetime.now(timezone.utc)))
            db.commit()
        prime_shared_quotes()
    finally:
        db.close()

    print(
        f"[EventLens] market={settings.market_data_provider} "
        f"news={settings.news_provider} realtime={settings.realtime_provider} "
        f"llm={settings.llm_provider} fixture_mode={settings.fixture_mode} "
        f"proxy={proxy or 'none'} "
        f"alpaca_configured={settings.alpaca_configured} deepseek_configured={settings.deepseek_configured}"
    )

    stop = asyncio.Event()

    async def broadcaster():
        realtime = provider_factory.create_realtime_provider()
        while not stop.is_set():
            symbols: set[str] = set()
            for subs in manager.subscriptions.values():
                symbols.update(subs)
            if symbols:
                try:
                    await realtime.subscribe(list(symbols))
                except Exception:
                    pass
                try:
                    # Parallel quote fetch — sequential Yahoo calls were a major lag source.
                    syms = list(symbols)[:20]

                    async def _one(sym: str):
                        try:
                            quote, _provider, _cached = await get_shared_quote(
                                sym,
                                max_age=5.0,
                                allow_stale=False,
                            )
                            return sym, quote
                        except Exception:
                            return sym, None

                    results = await asyncio.gather(*[_one(s) for s in syms])
                    for sym, q in results:
                        if q is None:
                            continue
                        msg = {
                            "type": "quote",
                            "symbol": sym,
                            "price": q.price,
                            "previousClose": q.previous_close,
                            "change": q.change,
                            "changePercent": q.change_percent,
                            "dayHigh": q.day_high,
                            "dayLow": q.day_low,
                            "volume": q.volume,
                            "marketState": q.market_state,
                            "delayed": q.delayed,
                            "timestamp": q.timestamp.isoformat(),
                            "provider": q.provider,
                        }
                        dead = []
                        for ws, subs in list(manager.subscriptions.items()):
                            if sym in subs:
                                try:
                                    await manager.send(ws, msg)
                                except Exception:
                                    dead.append(ws)
                        for ws in dead:
                            manager.disconnect(ws)
                except Exception:
                    pass
            try:
                await asyncio.wait_for(stop.wait(), timeout=8)
            except asyncio.TimeoutError:
                continue
        try:
            await realtime.close()
        except Exception:
            pass

    task = asyncio.create_task(broadcaster())
    yield
    stop.set()
    await task


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="EventLens API", version="1.0.0", lifespan=lifespan)
    app.add_middleware(GZipMiddleware, minimum_size=1_000, compresslevel=5)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin, "http://127.0.0.1:5173", "http://localhost:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router, prefix="/api")

    @app.websocket("/ws/market")
    async def ws_market(websocket: WebSocket):
        await manager.connect(websocket)
        await manager.send(websocket, {"type": "hello", "message": "EventLens market stream"})
        try:
            while True:
                raw = await websocket.receive_text()
                try:
                    payload = json.loads(raw)
                except Exception:
                    continue
                action = payload.get("action")
                symbols = [str(s).upper() for s in payload.get("symbols") or []]
                if action == "subscribe":
                    manager.subscriptions[websocket].update(symbols)
                    await manager.send(websocket, {"type": "subscribed", "symbols": list(manager.subscriptions[websocket])})
                elif action == "unsubscribe":
                    for s in symbols:
                        manager.subscriptions[websocket].discard(s)
                    await manager.send(websocket, {"type": "subscribed", "symbols": list(manager.subscriptions[websocket])})
                elif action == "ping":
                    await manager.send(websocket, {"type": "pong"})
        except WebSocketDisconnect:
            manager.disconnect(websocket)

    return app


app = create_app()
