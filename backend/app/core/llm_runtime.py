"""Runtime LLM settings override (persisted to JSON, takes effect without restart)."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from typing import Any

from app.core.config import get_settings

_LOCK = threading.Lock()
_DATA_DIR = Path(__file__).resolve().parents[2] / "data"
_SETTINGS_PATH = _DATA_DIR / "llm_settings.json"

LLM_PROVIDERS = ("rules", "openai", "deepseek", "qwen")
CLOUD_PROVIDERS = ("openai", "deepseek", "qwen")

PROVIDER_DEFAULTS: dict[str, dict[str, str]] = {
    "openai": {
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini",
    },
    "deepseek": {
        "baseUrl": "https://api.deepseek.com",
        "model": "deepseek-v4-flash",
    },
    "qwen": {
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "model": "qwen-plus",
    },
}

# In-memory overlay; None values mean "use .env defaults".
_runtime: dict[str, Any] = {}


def _load_file() -> dict[str, Any]:
    if not _SETTINGS_PATH.exists():
        return {}
    try:
        raw = json.loads(_SETTINGS_PATH.read_text(encoding="utf-8"))
        return raw if isinstance(raw, dict) else {}
    except Exception:
        return {}


def reload_runtime() -> None:
    global _runtime
    with _LOCK:
        _runtime = _load_file()


# Load once on import.
reload_runtime()


def effective_llm_config() -> dict[str, Any]:
    """Merge .env Settings with runtime overrides."""
    s = get_settings()
    with _LOCK:
        r = dict(_runtime)
    provider = (r.get("llmProvider") or s.llm_provider or "rules").strip().lower()
    if provider not in LLM_PROVIDERS:
        provider = "rules"

    defaults = PROVIDER_DEFAULTS.get(provider) or PROVIDER_DEFAULTS["deepseek"]
    api_key = (r.get("deepseekApiKey") if "deepseekApiKey" in r else s.deepseek_api_key) or ""

    if "deepseekBaseUrl" in r and str(r.get("deepseekBaseUrl") or "").strip():
        base_url = r["deepseekBaseUrl"]
    elif provider == "deepseek":
        base_url = s.deepseek_base_url or defaults["baseUrl"]
    else:
        base_url = defaults["baseUrl"]

    if "deepseekModel" in r and str(r.get("deepseekModel") or "").strip():
        model = r["deepseekModel"]
    elif provider == "deepseek":
        model = s.deepseek_model or defaults["model"]
    else:
        model = defaults["model"]

    try:
        timeout = int(
            r.get("deepseekTimeoutSeconds") if "deepseekTimeoutSeconds" in r else s.deepseek_timeout_seconds
        )
    except Exception:
        timeout = 30
    configured = bool(str(api_key).strip())
    if provider in CLOUD_PROVIDERS and configured:
        effective_provider: str = provider
    else:
        effective_provider = "rules"

    return {
        "llmProvider": provider,
        "effectiveProvider": effective_provider,
        "deepseekApiKey": str(api_key),
        "deepseekBaseUrl": str(base_url).rstrip("/"),
        "deepseekModel": str(model),
        "deepseekTimeoutSeconds": max(10, min(timeout, 180)),
        "deepseekConfigured": configured,
        "source": "runtime" if r else "env",
    }


def public_llm_view() -> dict[str, Any]:
    cfg = effective_llm_config()
    key = cfg["deepseekApiKey"]
    masked = ""
    if key:
        if len(key) <= 8:
            masked = "*" * len(key)
        else:
            masked = f"{key[:4]}…{key[-4:]}"
    return {
        "llmProvider": cfg["llmProvider"],
        "effectiveProvider": cfg["effectiveProvider"],
        "deepseekConfigured": cfg["deepseekConfigured"],
        "deepseekApiKeyMasked": masked,
        "deepseekHasKey": bool(key),
        "deepseekBaseUrl": cfg["deepseekBaseUrl"],
        "deepseekModel": cfg["deepseekModel"],
        "deepseekTimeoutSeconds": cfg["deepseekTimeoutSeconds"],
        "providerDefaults": PROVIDER_DEFAULTS,
        "source": cfg["source"],
    }


def save_llm_settings(payload: dict[str, Any]) -> dict[str, Any]:
    """Persist overrides. Empty apiKey string keeps the previous key unless clearKey=true."""
    _DATA_DIR.mkdir(parents=True, exist_ok=True)
    with _LOCK:
        current = dict(_runtime) if _runtime else _load_file()
        next_data = dict(current)

        provider = payload.get("llmProvider")
        if provider in LLM_PROVIDERS:
            next_data["llmProvider"] = provider

        if "deepseekBaseUrl" in payload and payload["deepseekBaseUrl"] is not None:
            next_data["deepseekBaseUrl"] = str(payload["deepseekBaseUrl"]).strip().rstrip("/") or current.get(
                "deepseekBaseUrl", "https://api.deepseek.com"
            )

        if "deepseekModel" in payload and payload["deepseekModel"] is not None:
            next_data["deepseekModel"] = str(payload["deepseekModel"]).strip() or current.get(
                "deepseekModel", "deepseek-v4-flash"
            )

        if "deepseekTimeoutSeconds" in payload and payload["deepseekTimeoutSeconds"] is not None:
            try:
                next_data["deepseekTimeoutSeconds"] = int(payload["deepseekTimeoutSeconds"])
            except Exception:
                pass

        clear_key = bool(payload.get("clearKey"))
        if clear_key:
            next_data["deepseekApiKey"] = ""
        elif "deepseekApiKey" in payload:
            new_key = payload.get("deepseekApiKey")
            if new_key is None:
                pass
            else:
                new_key = str(new_key).strip()
                # Ignore placeholder / unchanged masked submissions.
                if new_key and "…" not in new_key and not set(new_key) <= {"*"}:
                    next_data["deepseekApiKey"] = new_key

        _SETTINGS_PATH.write_text(json.dumps(next_data, ensure_ascii=False, indent=2), encoding="utf-8")
        _runtime.clear()
        _runtime.update(next_data)

    return public_llm_view()
