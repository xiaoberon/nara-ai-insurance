# Nara 展示版部署

## 本地开发

运行 `npm ci` 与 `npm run dev` 打开原 PoC 调试工作台。此入口保留可编辑案例、单阶段调试和批量评测。

要预览固定案例的公开工作台，运行 `npm run build` 与 `npm run showcase`，打开 `http://127.0.0.1:3002/live/`。模型密钥由服务端环境读取，纯规则和历史回放可直接验证。历史回放为 `/replay/`，读取随项目发布的历史 JSON。

## 公开部署

两个线上入口复用同一 Vite 构建。运行 `npm run build` 生成入口和浏览器资源，再运行 `node deploy/build-worker.mjs` 将实时工作台打包到 Worker。回放 Site 部署 `dist/client` 的静态资源。产品详情页仍由公开只读目录提供。


- 回放通过 `/replay/` 直接进入三模式历史评估。静态回放无需任何密钥。
- 视频播放器使用 `public/film/nara-challenge.mp4`。本地交付包含压缩版成片；在使用仅含源码的分发版本部署时，将获准公开的 MP4 放到该位置。使用支持 Range 请求的托管。
- 容器从仓库根目录运行 `docker build -f deploy/Dockerfile -t nara-showcase .`。部署到可访问 Gemini 的支持地区，单实例，超时时间至少 180 秒，平台侧设置独立的 Gemini 项目配额。容器设置服务端密钥 `GEMINI_API_KEY` 与 `NARA_GATEWAY_SECRET`，以及 `GEMINI_MODEL`、`NARA_ALLOWED_COUNTRIES`（经 Google 最新地区列表核对的两位国家代码）和 `NARA_DAILY_MODEL_CALLS`。进程限额按 UTC 日重置，进程重启会重置计数，由供应商配额提供外层保护。
- 将 `gateway.mjs` 部署到 Cloudflare Worker，设置 `NARA_ORIGIN` 为容器 HTTPS 入口，`NARA_GATEWAY_SECRET` 与容器一致。网关用 Cloudflare 地区元数据覆盖来访请求头。直接访问容器不能绕过 Gemini 调用的地区及网关密钥校验。
- 公开入口以网关地址为准。部署后检查 `/live/` 的 Gemini 与 Rules Only、`/replay/` 的离线评测数据，以及 `/film/` 的匿名视频播放。更新 README 的入口，并从大陆移动与宽带网络分别验证回放与视频。
