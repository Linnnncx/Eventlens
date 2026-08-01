from __future__ import annotations

import json
import re
from typing import Any

from app.core.config import get_settings
from app.schemas.market import NewsAnalysis, RiskSummary

PROMPT_VERSION = "v1"


class RuleBasedLLMProvider:
    name = "rules"

    async def analyze_news(self, payload: dict[str, Any]) -> NewsAnalysis:
        headline = (payload.get("headline") or "").lower()
        summary = (payload.get("summary") or "").lower()
        text = f"{headline} {summary}"

        event_type = "other"
        direction = "uncertain"
        importance = "medium"
        if any(k in text for k in ("earnings", "eps", "revenue", "财报", "季报")):
            event_type = "earnings"
            importance = "high"
        elif any(k in text for k in ("guidance", "outlook", "指引")):
            event_type = "guidance"
            importance = "high"
        elif any(k in text for k in ("lawsuit", "sec", "regulation", "ban", "监管", "诉讼")):
            event_type = "regulation"
            direction = "negative"
        elif any(k in text for k in ("launch", "product", "gpu", "chip", "发布", "产品")):
            event_type = "product"
        elif any(k in text for k in ("upgrade", "downgrade", "analyst", "price target", "评级")):
            event_type = "analyst"
        elif any(k in text for k in ("ceo", "cfo", "appoint", "resign", "管理层")):
            event_type = "management"

        if any(k in text for k in ("beat", "surge", "record", "growth", "上涨", "超预期", "突破")):
            direction = "positive"
        elif any(k in text for k in ("miss", "cut", "probe", "decline", "下跌", "不及预期", "调查")):
            direction = "negative"

        summary_zh = f"【规则摘要】{payload.get('headline') or '无标题'}。类型倾向为{event_type}，方向评估为{direction}（基于关键词，非模型推断）。"
        return NewsAnalysis(
            summaryZh=summary_zh,
            eventType=event_type,  # type: ignore[arg-type]
            importance=importance,  # type: ignore[arg-type]
            direction=direction,  # type: ignore[arg-type]
            timeHorizon="short_term",
            keyPoints=["基于标题与摘要的规则分类", "不构成投资建议"],
            uncertainties=["公开信息可能不完整", "价格变化未必由该事件单独导致"],
        )

    async def generate_risk_summary(self, payload: dict[str, Any]) -> RiskSummary:
        warnings = payload.get("ruleWarnings") or []
        level = "low"
        if len(warnings) >= 3:
            level = "high"
        elif len(warnings):
            level = "medium"
        mapping = {
            "single_position_concentration": "交易后个股仓位可能过高",
            "sector_concentration": "交易后行业集中度偏高",
            "low_cash_ratio": "交易后现金比例偏低",
            "large_order_size": "单笔订单占净值比例较高",
            "post_event_volatility": "事件后短期波动偏大",
            "high_volume_spike": "成交量相对均值显著放大",
            "missing_stop_loss": "未设置止损",
            "fresh_major_event": "重大事件发生不久，信息可能尚未充分消化",
        }
        points = [mapping.get(w, w) for w in warnings] or ["未触发主要集中度/事件风险规则"]
        return RiskSummary(
            summary=f"规则引擎识别到 {len(warnings)} 项关注点。请结合事件背景自行判断仓位与时机。",
            riskLevel=level,  # type: ignore[arg-type]
            attentionPoints=points,
            disclaimer="以上为基于规则事实的风险说明，不构成投资建议或买卖指令。",
        )


class DeepSeekLLMProvider:
    name = "deepseek"

    def __init__(self) -> None:
        self.settings = get_settings()
        self._rules = RuleBasedLLMProvider()

    def _client(self):
        from openai import AsyncOpenAI

        if not self.settings.deepseek_configured:
            raise RuntimeError("DeepSeek key missing")
        return AsyncOpenAI(
            api_key=self.settings.deepseek_api_key,
            base_url=self.settings.deepseek_base_url,
            timeout=self.settings.deepseek_timeout_seconds,
        )

    async def analyze_news(self, payload: dict[str, Any]) -> NewsAnalysis:
        if not self.settings.deepseek_configured:
            return await self._rules.analyze_news(payload)
        prompt = {
            "task": "Analyze US equity news. Return JSON only.",
            "schema": {
                "summaryZh": "string",
                "eventType": "earnings|guidance|product|regulation|analyst|management|macro|legal|other",
                "importance": "low|medium|high",
                "direction": "positive|negative|neutral|uncertain",
                "timeHorizon": "immediate|short_term|medium_term|long_term",
                "keyPoints": ["string"],
                "uncertainties": ["string"],
            },
            "rules": [
                "Do not give buy/sell advice",
                "Do not predict prices",
                "Be cautious about causality",
            ],
            "news": payload,
        }
        try:
            client = self._client()
            resp = await client.chat.completions.create(
                model=self.settings.deepseek_model,
                messages=[
                    {"role": "system", "content": "You are a cautious financial news analyst. Output valid JSON only."},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                temperature=0.2,
            )
            text = resp.choices[0].message.content or ""
            data = _extract_json(text)
            return NewsAnalysis.model_validate(data)
        except Exception:
            try:
                # one retry via rules is acceptable per spec after failed validation
                client = self._client()
                resp = await client.chat.completions.create(
                    model=self.settings.deepseek_model,
                    messages=[
                        {"role": "system", "content": "Return ONLY compact JSON matching the schema."},
                        {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                    ],
                    temperature=0,
                )
                text = resp.choices[0].message.content or ""
                data = _extract_json(text)
                return NewsAnalysis.model_validate(data)
            except Exception:
                return await self._rules.analyze_news(payload)

    async def generate_risk_summary(self, payload: dict[str, Any]) -> RiskSummary:
        if not self.settings.deepseek_configured:
            return await self._rules.generate_risk_summary(payload)
        prompt = {
            "task": "Explain trading risk facts in Chinese. No buy/sell advice.",
            "facts": payload,
            "output": {
                "summary": "string",
                "riskLevel": "low|medium|high",
                "attentionPoints": ["string"],
                "disclaimer": "string",
            },
            "forbidden": ["建议买入", "建议卖出", "应该交易", "上涨概率", "目标价", "收益预测"],
        }
        try:
            client = self._client()
            resp = await client.chat.completions.create(
                model=self.settings.deepseek_model,
                messages=[
                    {"role": "system", "content": "Explain precomputed risk facts. JSON only. No recommendations."},
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                temperature=0.2,
            )
            text = resp.choices[0].message.content or ""
            data = _extract_json(text)
            return RiskSummary.model_validate(data)
        except Exception:
            return await self._rules.generate_risk_summary(payload)


def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))
