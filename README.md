# EventLens｜事件交易台

事件驱动型美股研究与模拟交易工作台：把新闻事件与 K 线时间对齐，观察事件前后市场反应，并在同一页面完成模拟下单与风险预览。

## 核心差异化

- **事件 × K 线对齐**：悬停 K 线在下方展示该时段新闻；按周期自适应桶对齐
- **事件反应窗口**：代码计算事件前后涨跌、量能倍数（非 LLM 编造）
- **同屏交易**：不离开工作台，右侧切换新闻 / 交易抽屉
- **风险预览**：仓位集中度 + 事件波动规则；DeepSeek 仅解释事实，默认可规则降级
- **Provider 可切换**：新闻默认 `merged`（Google News + Finnhub + Yahoo）；行情默认 yfinance；可切 Alpaca / Fixture，前端零改动

> 本产品不预测股价，不输出买卖建议或收益承诺。所有订单均为模拟成交。

## 技术架构

| 层 | 技术 |
|----|------|
| 前端 | React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand, Lightweight Charts |
| 后端 | FastAPI, SQLAlchemy, SQLite, yfinance, Pydantic |
| LLM | DeepSeek（可选）/ 规则模板 |
| 数据 | yfinance（行情）/ Google News + Finnhub + Yahoo（新闻，merged）/ Alpaca / Fixture |

## 目录结构

```
eventlens/
├─ frontend/          # Vite React 应用
├─ backend/           # FastAPI 服务
│  ├─ app/providers/  # market / news / llm providers
│  └─ data/           # symbol universe + fixtures + sqlite
├─ scripts/
├─ .env.example
├─ docker-compose.yml
└─ README.md
```

## 环境要求

- Python **3.11+**（已在 3.12/3.13 验证思路）
- Node.js **20+**
- 无需 Alpaca / DeepSeek Key 即可完整运行

## 快速启动（本地）

```bash
# 1) 环境变量
cp .env.example .env

# 2) 后端
cd backend
python -m venv .venv
# Windows:
.\.venv\Scripts\activate
# macOS/Linux:
# source .venv/bin/activate
pip install -r requirements.txt
mkdir -p data
uvicorn app.main:app --reload --port 8000

# 3) 前端（新终端）
cd frontend
npm install
cd frontend
```

- 前端：http://localhost:5173  
- 后端：http://localhost:8000  
- Swagger：http://localhost:8000/docs  

### Docker

```bash
cp .env.example .env
docker compose up --build
```

## 环境变量要点

见根目录 `.env.example`。

| 变量 | 说明 |
|------|------|
| `MARKET_DATA_PROVIDER` | `yfinance` / `alpaca` / `fixture` |
| `NEWS_PROVIDER` | `merged`（推荐）/ `finnhub` / `yfinance` / `alpaca` / `fixture` |
| `REALTIME_PROVIDER` | `yfinance` / `alpaca` / `fixture` |
| `FIXTURE_MODE` | `true` 时强制 Fixture |
| `LLM_PROVIDER` | `rules`（默认）或 `deepseek` |
| `DEEPSEEK_API_KEY` | 可选 |
| `FINNHUB_API_KEY` | Finnhub 免费 key；缺失时新闻回退 yfinance → fixture |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | 可选；缺失不影响 yfinance / finnhub |

API Key 仅存在于后端，不会下发前端。

## 数据 Provider 说明

1. **merged（新闻推荐）**：并发合并 Google News RSS + Finnhub + Yahoo 后按标题去重，覆盖整段 K 线窗口  
2. **Google News RSS**：无需 key，`after:`/`before:` 支持任意日期区间；按周切片抓取，过滤 13F 持仓类噪音  
3. **Finnhub**：`/company-news` 支持 `from`/`to` 日期；填 `FINNHUB_API_KEY` 后自动并入 merged  
4. **yfinance**：行情、K 线、搜索；新闻只有最近 1～2 天；阻塞调用经 `asyncio.to_thread`  
5. **Fixture**：AAPL/NVDA/TSLA/MSFT/META 演示数据；离线 / 失败时降级  
6. **Alpaca**：行情与新闻完整实现；无 Key 时返回 `ProviderUnavailable`  

降级顺序：当前 Provider → 缓存 → Fixture → 结构化错误。

## DeepSeek

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-v4-flash
```

未配置时自动使用规则模板做中文摘要与风险解释。LLM **不**计算涨跌幅、仓位、MACD，也不给买卖建议。

## 切换 Alpaca

```env
MARKET_DATA_PROVIDER=alpaca
NEWS_PROVIDER=alpaca
REALTIME_PROVIDER=alpaca
ALPACA_API_KEY=...
ALPACA_API_SECRET=...
```

重启后端即可；接口路径与响应 Schema 不变。

## Fixture 演示流程

1. 设置 `FIXTURE_MODE=true` 或在 yfinance 不可用时自动降级  
2. 打开 **NVDA** 工作台，选择 **5Min**  
3. 悬停有圆点标记的 K 线 → 下方列出该时段新闻 → 点击查看详情  
4. 查看事件反应指标 → 买入较大数量触发集中度/事件风险  
5. 减小数量、添加止损 → 模拟成交 → 持仓与成本线更新  

## 测试

```bash
# 后端
cd backend
.\.venv\Scripts\python -m pytest tests -q

# 前端
cd frontend
npm test
```

## 演示路径（产品）

发现异动 → 查看 K 线新闻 → 事件反应 → 同屏交易 → 风险预览 → 模拟成交 → 持仓更新。

## 已知限制

- yfinance 日内数据有时间范围限制；后端会裁剪请求窗口  
- yfinance WebSocket 不稳定时自动降级为轮询广播  
- Alpaca 实时流在本版本以轮询形状兼容实现（消息协议与前端一致）  
- 模拟交易非真实券商接口  

## 风险声明

EventLens 仅供研究与产品演示。市场数据可能延迟或来自缓存/Fixture。所有分析与风险说明不构成投资建议，不保证收益，请勿用于实盘决策。

## 已完成清单

- [x] Provider 抽象（yfinance / Alpaca / Fixture / DeepSeek / Rules）
- [x] 统一内部 Schema 与公开 API
- [x] 市场首页 + 股票工作台（桌面三栏 / 移动 Bottom Sheet）
- [x] Lightweight Charts + MA/MACD/RSI + 新闻 Marker
- [x] 事件反应计算 + 新闻分析
- [x] 模拟交易、订单预览、风险规则、账户持久化
- [x] WebSocket `/ws/market` + 轮询降级
- [x] 150+ 标的池、Fixture、README、Docker Compose、基础测试
