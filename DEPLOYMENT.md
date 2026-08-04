# EventLens 服务器部署

生产部署与本地开发完全分离：本地继续使用 `docker-compose.yml` 和 `.env`，服务器使用
`docker-compose.prod.yml` 和 `.env.production`。

## 1. 服务器准备

Ubuntu 24.04 安装 Docker Engine 与 Compose 插件后，只在云防火墙开放：

- 22/TCP：SSH，推荐仅允许管理员公网 IP
- 80/TCP：HTTP
- 443/TCP：HTTPS（配置域名后使用）

不要开放 8000；后端仅通过容器网络供前端 Nginx 访问。

## 2. 配置

```bash
git clone https://github.com/Linnnncx/Eventlens.git
cd Eventlens
cp .env.production.example .env.production
nano .env.production
chmod 600 .env.production
```

至少修改 `FRONTEND_ORIGIN`。真实新闻推荐填写 `FINNHUB_API_KEY`；使用 Alpaca 时必须同时填写
`ALPACA_API_KEY`、`ALPACA_API_SECRET`，并把行情和实时 Provider 都改为 `alpaca`。

服务器没有本机代理时，`HTTP_PROXY` 和 `HTTPS_PROXY` 必须留空。

## 3. 启动与检查

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=100 backend
docker compose -f docker-compose.prod.yml logs --tail=100 news-scheduler
curl http://127.0.0.1/api/health
```

访问 `http://服务器公网IP`。三个容器均配置了健康检查、日志轮转和
`restart: unless-stopped`，服务器重启后会自动恢复。

## 4. 数据更新策略

- 行情：用户打开市场、自选或股票详情后按需刷新，全部标的仍可查看。
- 新闻：生产环境额外运行 `news-scheduler`，默认每 15 分钟预热最多 10 个显式配置、
  自选和核心标的。
- 数据：SQLite、新闻缓存、运行时设置和调度器心跳均持久化在 `backend/data`。

查看调度状态：

```bash
docker compose -f docker-compose.prod.yml logs -f news-scheduler
cat backend/data/news_scheduler_heartbeat.json
```

## 5. 更新版本

```bash
git pull --ff-only
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

更新不会删除 `backend/data`。上线前仍建议备份 SQLite 数据库与 `.env.production`。
