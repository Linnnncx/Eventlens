from __future__ import annotations

import json
import re
from typing import Any

from app.schemas.market import NewsAnalysis, RangeAnalysisReport, RiskSummary

PROMPT_VERSION = "v2-trader"


class RuleBasedLLMProvider:
    name = "rules"

    async def analyze_news(self, payload: dict[str, Any]) -> NewsAnalysis:
        headline = (payload.get("headline") or "").lower()
        summary = (payload.get("summary") or "").lower()
        text = f"{headline} {summary}"
        raw_headline = payload.get("headline") or "无标题"

        event_type = "other"
        direction = "uncertain"
        importance = "medium"
        horizon = "short_term"
        points: list[str] = []
        uncertainties: list[str] = [
            "公开信息可能不完整，二手转述可能失真",
            "价格反应未必由该单一事件驱动，需对照盘面量价",
        ]

        if any(k in text for k in ("earnings", "eps", "revenue", "财报", "季报", "guidance beat", "miss")):
            event_type = "earnings"
            importance = "high"
            horizon = "immediate"
            points.append("财报/业绩类事件：关注 EPS、营收、指引是否超预期及管理层口径")
        elif any(k in text for k in ("guidance", "outlook", "指引", "forecast")):
            event_type = "guidance"
            importance = "high"
            horizon = "short_term"
            points.append("指引/展望调整：往往比当期业绩更能驱动估值重定价")
        elif any(k in text for k in ("lawsuit", "sec", "regulation", "ban", "监管", "诉讼", "antitrust", "probe")):
            event_type = "regulation"
            direction = "negative"
            importance = "high"
            horizon = "medium_term"
            points.append("监管/诉讼类：尾部风险与时间不确定性较高，关注可量化影响区间")
        elif any(k in text for k in ("launch", "product", "gpu", "chip", "发布", "产品", "unveil")):
            event_type = "product"
            points.append("产品/技术发布：区分「叙事催化」与「可验证订单/份额」")
        elif any(k in text for k in ("upgrade", "downgrade", "analyst", "price target", "评级", "overweight", "underweight")):
            event_type = "analyst"
            points.append("券商评级变动：多为情绪脉冲，需看目标价调整幅度与一致性预期差")
        elif any(k in text for k in ("ceo", "cfo", "appoint", "resign", "管理层", "step down")):
            event_type = "management"
            importance = "medium"
            points.append("管理层变动：关注继任安排、战略连续性与内部治理信号")
        elif any(k in text for k in ("fed", "inflation", "rates", "macro", "关税", "tariff", "cpi")):
            event_type = "macro"
            horizon = "short_term"
            points.append("宏观/政策外溢：个股 beta 可能被指数情绪放大或对冲")

        if any(k in text for k in ("beat", "surge", "record", "growth", "上涨", "超预期", "突破", "raise", "strong")):
            direction = "positive"
        elif any(k in text for k in ("miss", "cut", "probe", "decline", "下跌", "不及预期", "调查", "slash", "weak")):
            direction = "negative"
        elif any(k in text for k in ("hold", "maintain", "in-line", "unchanged", "持平")):
            direction = "neutral"

        if not points:
            points.append("事件类型不够清晰，建议回看原文关键数据与时间锚点")
        points.append(f"初步方向判断：{direction}（关键词启发式，非模型深读）")
        points.append("交易台视角：先问「是否改变现金流预期」，再问「是否已被定价」")

        dir_zh = {"positive": "偏利好", "negative": "偏利空", "neutral": "中性", "uncertain": "尚不确定"}.get(
            direction, direction
        )
        summary_zh = (
            f"【交易台快评】{raw_headline}。"
            f"事件归类为 {event_type}，重要度 {importance}，方向 {dir_zh}，影响窗口偏 {horizon}。"
            f"重点看信息是否改变盈利/估值假设，以及盘面是否已提前反映；"
            f"避免把标题情绪直接等同于可交易 alpha。"
        )
        return NewsAnalysis(
            summaryZh=summary_zh,
            eventType=event_type,  # type: ignore[arg-type]
            importance=importance,  # type: ignore[arg-type]
            direction=direction,  # type: ignore[arg-type]
            timeHorizon=horizon,  # type: ignore[arg-type]
            keyPoints=points[:6],
            uncertainties=uncertainties,
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

    async def analyze_range(self, payload: dict[str, Any]) -> RangeAnalysisReport:
        tech = payload.get("technical") or {}
        news = payload.get("news") or {}
        symbol = payload.get("symbol") or ""
        timeframe = payload.get("timeframe") or "1Day"
        start = payload.get("start")
        end = payload.get("end")
        change_pct = float(tech.get("changePercent") or 0)
        trend = tech.get("trendLabel") or "震荡"
        mix = news.get("directionMix") or {}
        pos = int(mix.get("positive") or 0)
        neg = int(mix.get("negative") or 0)
        bar_count = int(tech.get("barCount") or 0)
        news_count = int(news.get("newsCount") or 0)

        checklist = tech.get("traderChecklist") or []
        patterns = tech.get("candlePatterns") or []
        supports = tech.get("supportLevels") or []
        resists = tech.get("resistanceLevels") or []
        desk = news.get("deskNotes") or []

        tech_parts = [
            f"{symbol} · {timeframe} · {bar_count} 根K线，区间涨跌 {change_pct:+.2f}%（{trend}）。",
            str(tech.get("sampleNote") or ""),
            f"收盘位于区间相对位置约 {tech.get('closePositionInRangePct', '—')}%；"
            f"高 {tech.get('high')} / 低 {tech.get('low')}，现价 {tech.get('close')}。",
            str(tech.get("structureNote") or ""),
            str(tech.get("maNote") or ""),
            str(tech.get("rsiNote") or ""),
            str(tech.get("macdNote") or ""),
            (tech.get("bollinger") or {}).get("note") or "",
            str(tech.get("volumeNote") or ""),
            str(tech.get("candleStreak") or ""),
        ]
        if not any(tech_parts[3:]):
            tech_parts.extend(str(x) for x in checklist[:4])
        if patterns:
            tech_parts.append("K线形态：" + "；".join(patterns[:4]))
        if supports or resists:
            tech_parts.append(
                f"关键位：支撑 {', '.join(str(x) for x in supports) or '—'}；"
                f"阻力 {', '.join(str(x) for x in resists) or '—'}。"
            )
        if tech.get("atrPercent") is not None:
            tech_parts.append(f"ATR(14) 约占价格 {tech.get('atrPercent')}%，波动环境需匹配仓位节奏。")
        tech_summary = "".join(p for p in tech_parts if p)

        if news_count == 0:
            news_summary = "该时间窗口内暂无可用新闻样本，新闻面结论受限，应以量价结构为主。"
        else:
            news_parts = [
                f"窗口内新闻约 {news_count} 条（抽样 {news.get('sampled', 0)}），情绪 {news.get('sentimentBias') or '混杂'}。",
                *desk,
            ]
            high_hits = news.get("highImpactHeadlines") or []
            if high_hits:
                tops = "；".join(h.get("headline", "")[:60] for h in high_hits[:3])
                news_parts.append(f"高影响标题摘录：{tops}。")
            news_parts.append(
                "交易台读法：区分「可验证基本面变化」与「叙事/评级噪声」，并对照价格是否已提前计价。"
            )
            news_summary = "".join(news_parts)

        if change_pct >= 2 and pos >= neg:
            outlook = (
                "量价与情绪整体偏多，短线关注阻力位能否放量承接；"
                "若指标已进入超买且量能衰减，则更宜等待回踩结构确认，而非追高外推。"
            )
        elif change_pct <= -2 and neg >= pos:
            outlook = (
                "量价与情绪整体偏空，短线盯支撑与是否缩量止跌；"
                "若出现强反转K线但无量能配合，反抽的持续性需打折。"
            )
        else:
            outlook = (
                "技术与新闻信号不完全同向，适合按关键支撑/阻力做情景推演："
                "突破看量能确认，跌破看是否加速；避免在混杂信号下重仓单向押注。"
            )

        key_points = [
            f"区间涨跌 {change_pct:+.2f}% · {trend} · {tech.get('structureNote') or ''}",
            str(tech.get("maNote") or "均线信息不足"),
            str(tech.get("rsiNote") or ""),
            str(tech.get("macdNote") or ""),
            f"新闻：{news.get('sentimentBias') or '—'}（利好 {pos} / 利空 {neg}）",
        ]
        if patterns:
            key_points.append("形态：" + patterns[0])
        key_points = [p for p in key_points if p][:6]

        return RangeAnalysisReport(
            symbol=symbol,
            timeframe=timeframe,
            start=start,
            end=end,
            title=f"{symbol} 区间交易台分析",
            summaryZh=f"{tech_summary} {news_summary} {outlook}",
            technicalSummary=tech_summary,
            newsSummary=news_summary,
            outlook=outlook,
            keyPoints=key_points,
            risks=[
                "指标与形态基于所选窗口样本，换周期可能结论不同",
                "新闻与价格变动未必存在因果关系，警惕事后归因",
                "高波动标的需同步考虑流动性与滑点，不构成投资建议",
            ],
            barCount=bar_count,
            newsCount=news_count,
            model=self.name,
            usedLlm=False,
        )


class DeepSeekLLMProvider:
    """OpenAI-compatible chat provider (OpenAI / DeepSeek / Qwen)."""

    def __init__(self) -> None:
        self._rules = RuleBasedLLMProvider()

    @property
    def name(self) -> str:
        cfg = self._cfg()
        return str(cfg.get("effectiveProvider") or "llm")

    def _cfg(self) -> dict[str, Any]:
        from app.core.llm_runtime import effective_llm_config

        return effective_llm_config()

    def _is_cloud(self, cfg: dict[str, Any]) -> bool:
        from app.core.llm_runtime import CLOUD_PROVIDERS

        return bool(cfg.get("deepseekConfigured") and cfg.get("effectiveProvider") in CLOUD_PROVIDERS)

    def _client(self):
        from openai import AsyncOpenAI

        cfg = self._cfg()
        if not cfg["deepseekConfigured"]:
            raise RuntimeError("LLM API key missing")
        return AsyncOpenAI(
            api_key=cfg["deepseekApiKey"],
            base_url=cfg["deepseekBaseUrl"],
            timeout=cfg["deepseekTimeoutSeconds"],
        )

    async def analyze_news(self, payload: dict[str, Any]) -> NewsAnalysis:
        cfg = self._cfg()
        if not self._is_cloud(cfg):
            return await self._rules.analyze_news(payload)
        prompt = {
            "task": "你是资深美股交易台分析师。对单条新闻做专业点评，中文输出，仅返回 JSON。",
            "schema": {
                "summaryZh": "string — 交易台口吻，2-5句：事件实质、定价含义、需验证的数据点",
                "eventType": "earnings|guidance|product|regulation|analyst|management|macro|legal|other",
                "importance": "low|medium|high",
                "direction": "positive|negative|neutral|uncertain",
                "timeHorizon": "immediate|short_term|medium_term|long_term",
                "keyPoints": ["string — 可执行观察点，非空话"],
                "uncertainties": ["string — 信息缺口与误读风险"],
            },
            "style": [
                "像专业交易员：谈催化剂质量、预期差、是否已被定价、影响时长",
                "区分硬数据（指引/订单/监管处罚）与软叙事（传闻/评级噪音）",
                "可提「关注什么价量确认」，但禁止买卖指令、目标价、收益预测",
                "不要堆砌形容词；用具体机制解释为何可能影响股价",
            ],
            "forbidden": ["建议买入", "建议卖出", "应该加仓", "目标价", "上涨概率"],
            "news": payload,
        }
        try:
            client = self._client()
            resp = await client.chat.completions.create(
                model=cfg["deepseekModel"],
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a professional US equity trading-desk analyst. "
                            "Write sharp Chinese commentary. Output valid JSON only. "
                            "No buy/sell recommendations."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                temperature=0.25,
            )
            text = resp.choices[0].message.content or ""
            data = _extract_json(text)
            return NewsAnalysis.model_validate(data)
        except Exception:
            try:
                client = self._client()
                resp = await client.chat.completions.create(
                    model=cfg["deepseekModel"],
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
        cfg = self._cfg()
        if not self._is_cloud(cfg):
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
                model=cfg["deepseekModel"],
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

    async def analyze_range(self, payload: dict[str, Any]) -> RangeAnalysisReport:
        cfg = self._cfg()
        if not self._is_cloud(cfg):
            return await self._rules.analyze_range(payload)
        prompt = {
            "task": (
                "你是资深美股短线/波段交易员。基于给定的预计算技术指标与新闻事实，"
                "对用户选定的 K 线窗口做专业复盘。中文，仅返回 JSON。"
            ),
            "schema": {
                "title": "string — 简洁交易台标题",
                "summaryZh": "string — 总览 4-8 句，先结构后催化，再谈风险",
                "technicalSummary": (
                    "string — 专业技术面：趋势结构、均线排列、RSI/MACD/布林、"
                    "量价、K线形态、支撑阻力；引用 payload.technical 中的数值，勿编造"
                ),
                "newsSummary": (
                    "string — 专业新闻面：主催化剂、事件类型、情绪是否冲突、"
                    "是否可能已被定价、与盘面是否同向；勿编造未给出的新闻"
                ),
                "outlook": (
                    "string — 情景推演（例如放量突破阻力 vs 缩量假突破；失守支撑 vs 锤头止跌），"
                    "禁止买卖指令与目标价"
                ),
                "keyPoints": ["string — 3-6 条可观察要点"],
                "risks": ["string — 2-4 条失效条件/误判风险"],
            },
            "analysisFramework": {
                "technical": [
                    "结构：HH/HL 或 LH/LL、收盘在区间位置",
                    "均线：多空排列、金叉死叉意味（用已给 MA）",
                    "动量：RSI 超买超卖、MACD 零轴与柱体",
                    "波动：布林带位置、ATR%",
                    "量价：放量/缩量是否确认突破或破位",
                    "形态：引用 candlePatterns 与 recentBars，描述末段 K 线含义",
                    "位置：supportLevels / resistanceLevels 如何约束下一步",
                ],
                "news": [
                    "按影响力排序催化剂，区分硬基本面 vs 评级/传闻噪声",
                    "情绪冲突时说明「噪声 vs 真信息」",
                    "把新闻时间与价格走势做对照（是否领先/滞后/背离）",
                    "明确信息缺口：缺什么数据会改变判断",
                ],
            },
            "style": [
                "口吻像交易台晨会：具体、可验证、少空话",
                "每个技术结论尽量挂钩指标数值或形态名称",
                "样本不足时明确降权，不要硬凑趋势",
            ],
            "forbidden": [
                "建议买入",
                "建议卖出",
                "目标价",
                "上涨概率",
                "编造未提供的新闻或指标",
            ],
            "context": payload,
        }
        try:
            client = self._client()
            resp = await client.chat.completions.create(
                model=cfg["deepseekModel"],
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "You are a professional US equity trading-desk analyst. "
                            "Write precise Chinese technical + news commentary using only provided facts. "
                            "Output valid JSON only. No investment recommendations or price targets."
                        ),
                    },
                    {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                ],
                temperature=0.3,
            )
            text = resp.choices[0].message.content or ""
            data = _extract_json(text)
            fallback = await self._rules.analyze_range(payload)
            return RangeAnalysisReport(
                symbol=payload.get("symbol") or fallback.symbol,
                timeframe=payload.get("timeframe") or fallback.timeframe,
                start=payload.get("start") or fallback.start,
                end=payload.get("end") or fallback.end,
                title=str(data.get("title") or f"{fallback.symbol} 区间交易台分析"),
                summaryZh=str(data.get("summaryZh") or fallback.summary_zh),
                technicalSummary=str(data.get("technicalSummary") or fallback.technical_summary),
                newsSummary=str(data.get("newsSummary") or fallback.news_summary),
                outlook=str(data.get("outlook") or fallback.outlook),
                keyPoints=list(data.get("keyPoints") or fallback.key_points),
                risks=list(data.get("risks") or fallback.risks),
                barCount=fallback.bar_count,
                newsCount=fallback.news_count,
                model=cfg["deepseekModel"],
                usedLlm=True,
            )
        except Exception:
            report = await self._rules.analyze_range(payload)
            return report.model_copy(
                update={
                    "title": f"{report.symbol} 区间分析（规则回退）",
                    "model": "llm-fallback",
                    "used_llm": False,
                }
            )

def _extract_json(text: str) -> dict[str, Any]:
    text = text.strip()
    try:
        return json.loads(text)
    except Exception:
        match = re.search(r"\{[\s\S]*\}", text)
        if not match:
            raise
        return json.loads(match.group(0))
