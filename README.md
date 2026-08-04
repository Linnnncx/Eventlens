# EventLens｜事件交易台

事件驱动型美股研究与模拟交易工作台：把新闻事件与 K 线时间对齐，观察事件前后市场反应，并在同一页面完成模拟下单与风险预览。

支持 **桌面工作台** 与 **手机端**（行情 / 资讯 / 交易 / 我的）。

> 本产品不预测股价，不输出买卖建议或收益承诺。所有订单均为模拟成交。

## 核心能力

- **事件 × K 线对齐**：悬停 / 点击 K 线查看该时段新闻；按周期自适应桶对齐
- **事件反应窗口**：代码计算事件前后涨跌、量能倍数
- **同屏交易**：桌面右侧新闻 / 交易；手机独立交易页 + 股票页快捷下单
- **AI 区间分析 / AI Summary**：技术面（均线、RSI、MACD、形态等）+ 新闻面；支持规则引擎或 OpenAI / DeepSeek / Qwen（前端 AI 设置即时生效）
- **风险预览**：仓位集中度 + 事件波动规则；LLM 仅解释事实，默认可规则降级
- **资产曲线 & 已平仓排行**（手机「我的」）：总资产趋势 + 已实现盈亏榜
- **今日涨跌热点图**（桌面首页）：涨 / 跌热力图
- **Provider 可切换**：新闻默认 `merged`；行情默认 yfinance；可切 Alpaca / Fixture

## 技术架构

| 层 | 技术 |
|----|------|
| 前端 | React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand, Lightweight Charts |
| 后端 | FastAPI, SQLAlchemy, SQLite, yfinance, Pydantic |
| LLM | 规则模板 / OpenAI · DeepSeek · Qwen（OpenAI 兼容接口，可选） |
| 数据 | yfinance（行情）/ Google News + Finnhub + Yahoo（新闻）/ Alpaca / Fixture |
| 部署 | Docker Compose（前端 Nginx 反代 `/api`、`/ws`） |

## 目录结构

```
eventlens/
├─ frontend/          # Vite React（含 desktop + mobile）
│  ├─ src/mobile/     # 手机端页面与图表
│  ├─ Dockerfile
│  └─ nginx.conf      # 生产静态站点 + API/WS 反代
├─ backend/           # FastAPI
│  ├─ app/providers/  # market / news / llm
│  ├─ app/services/   # trading / range_analysis / equity_history …
│  └─ data/           # universe / fixtures / sqlite（运行时）
├─ scripts/
├─ .env.example
├─ docker-compose.yml
└─ README.md
```

## 环境要求

- Python **3.11+**（Docker 镜像为 3.12）
- Node.js **20+**（Docker 构建为 22）
- 可选：Docker / Docker Compose（服务器部署推荐）

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
npm run dev
```

- 前端：http://localhost:5173  
- 后端：http://localhost:8000  
- Swagger：http://localhost:8000/docs  

窄屏会自动进入手机端布局；也可用浏览器开发者工具模拟移动设备。

## 服务器部署（Docker）

**可以部署。** 仓库已自带 `docker-compose.yml`、前后端 Dockerfile，以及 Nginx 对 `/api`、`/ws` 的反代，适合单机 VPS。

```bash
cp .env.example .env
# 编辑 .env：生产建议 FIXTURE_MODE=false，并按需填 FINNHUB / LLM Key
# FRONTEND_ORIGIN 填你的公网地址（若浏览器直连后端跨域时需要），例如 https://your.domain
docker compose up --build -d
```

默认端口：

| 服务 | 宿主机端口 |
|------|------------|
| 前端（Nginx） | **5173 → 容器 80**（可自行改映射为 80/443） |
| 后端 | **8000**（通常只需内网，由 Nginx 反代） |

访问：`http://<服务器IP>:5173`（或你改过的端口）。

### 部署前请确认

1. **出网**：真实行情 / 新闻依赖 Yahoo、Finnhub 等；服务器需能访问外网（部分地区可能需代理）。离线可用 `FIXTURE_MODE=true`。
2. **持久化**：`./backend/data` 已挂载；SQLite、新闻缓存、LLM 运行时配置、资产曲线会落在此目录。
3. **单机 SQLite**：适合演示 / 小流量；多副本或高并发需改 Postgres 等（当前未内置）。
4. **HTTPS**：建议在前面再加一层 Caddy / Nginx / 云负载均衡做 TLS，反代到本机 5173。
5. **密钥**：勿把 `.env`、`llm_settings.json`、数据库文件提交到 Git（已在 `.gitignore`）。

### AI（可选）

- 环境变量：`LLM_PROVIDER` + 对应 Key（见 `.env.example`）
- 或启动后在前端 **AI 设置** 中选择 OpenAI / DeepSeek / Qwen 并保存（写入后端 `data/llm_settings.json`，无需重启）

## 环境变量要点

见根目录 `.env.example`。

| 变量 | 说明 |
|------|------|
| `FRONTEND_ORIGIN` | 前端源站（CORS）；Docker 同域反代时可保持默认 |
| `MARKET_DATA_PROVIDER` | `yfinance` / `alpaca` / `fixture` |
| `NEWS_PROVIDER` | `merged`（推荐）/ `finnhub` / `yfinance` / `alpaca` / `fixture` |
| `REALTIME_PROVIDER` | `yfinance` / `alpaca` / `fixture` |
| `FIXTURE_MODE` | `true` 时强制 Fixture |
| `LLM_PROVIDER` | `rules`（默认）或 `deepseek`（也可被前端运行时设置覆盖） |
| `DEEPSEEK_API_KEY` 等 | 可选；也支持前端配置 OpenAI / Qwen |
| `FINNHUB_API_KEY` | Finnhub 免费 key |
| `ALPACA_API_KEY` / `ALPACA_API_SECRET` | 可选 |
| `INITIAL_CASH` | 模拟初始资金 |

API Key 仅存在于后端，不会明文回传前端。

## 数据 Provider 说明

1. **merged（新闻推荐）**：并发合并 Google News RSS + Finnhub + Yahoo，去重后覆盖 K 线窗口  
2. **Google News RSS**：无需 key，支持日期区间  
3. **Finnhub**：填 `FINNHUB_API_KEY` 后并入 merged  
4. **yfinance**：行情、K 线、搜索；新闻窗口较短  
5. **Fixture**：离线演示数据  
6. **Alpaca**：有 Key 时可用  

降级：当前 Provider → 缓存 → Fixture → 结构化错误。

### 新闻预热（推荐）

```bash
cd backend
python -m scripts.warm_news                 # 核心自选池
python -m scripts.warm_news AAPL MSFT NVDA  # 指定标的
python -m scripts.warm_news --all           # 全量
python -m scripts.warm_news --force         # 强制重抓
```

## Fixture 演示流程

1. `FIXTURE_MODE=true` 或 yfinance 不可用时自动降级  
2. 打开 **NVDA** 工作台，选择 **5Min**  
3. 悬停有标记的 K 线 → 查看新闻与事件反应  
4. 模拟下单 → 持仓与成本线更新  

## 测试

```bash
# 后端
cd backend
.\.venv\Scripts\python -m pytest tests -q

# 前端
cd frontend
npm test
```

## 已知限制

- yfinance 日内数据有时间范围限制；后端会裁剪请求窗口  
- yfinance WebSocket 不稳定时自动降级为轮询广播  
- Alpaca 实时流以轮询形状兼容实现  
- 模拟交易非真实券商接口  
- 单机 SQLite，未做多实例共享库  

## 风险声明

EventLens 仅供研究与产品演示。市场数据可能延迟或来自缓存/Fixture。所有分析与风险说明不构成投资建议，不保证收益，请勿用于实盘决策。
