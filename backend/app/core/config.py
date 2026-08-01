from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

_ROOT = Path(__file__).resolve().parents[3]
_ENV_CANDIDATES = (_ROOT / ".env", Path.cwd() / ".env", Path.cwd().parent / ".env")


def _env_file() -> str:
    for p in _ENV_CANDIDATES:
        if p.exists():
            return str(p)
    return str(_ROOT / ".env.example")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=_env_file(), env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    frontend_origin: str = "http://localhost:5173"
    database_url: str = "sqlite:///./data/eventlens.db"
    default_market_timezone: str = "America/New_York"

    market_data_provider: Literal["yfinance", "alpaca", "fixture"] = "yfinance"
    # merged: Finnhub (historical date range) + Yahoo (freshest), de-duplicated
    news_provider: Literal["merged", "finnhub", "yfinance", "alpaca", "fixture"] = "merged"
    realtime_provider: Literal["yfinance", "alpaca", "fixture"] = "yfinance"
    fixture_mode: bool = False

    finnhub_api_key: str = ""

    # Local Clash/V2Ray HTTP proxy. Python does NOT use Windows system proxy automatically.
    http_proxy: str = ""
    https_proxy: str = ""

    yfinance_cache_dir: str = "./data/yfinance-cache"
    yfinance_request_timeout: int = 20
    yfinance_batch_size: int = 30
    yfinance_market_refresh_seconds: int = 30
    yfinance_quote_refresh_seconds: int = 5
    yfinance_news_refresh_seconds: int = 300
    yfinance_enable_websocket: bool = True

    alpaca_api_key: str = ""
    alpaca_api_secret: str = ""
    alpaca_feed: str = "iex"

    llm_provider: Literal["rules", "deepseek"] = "rules"
    deepseek_api_key: str = ""
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_thinking: bool = False
    deepseek_timeout_seconds: int = 30

    initial_cash: float = 100000.0

    @property
    def alpaca_configured(self) -> bool:
        return bool(self.alpaca_api_key and self.alpaca_api_secret)

    @property
    def finnhub_configured(self) -> bool:
        return bool(self.finnhub_api_key)

    @property
    def deepseek_configured(self) -> bool:
        return bool(self.deepseek_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
