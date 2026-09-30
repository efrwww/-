// WonderForge 后端入口：装配中间件、API 路由、静态资源与 SPA fallback
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { requestLogger } from './middleware/requestLogger.mjs';
import { errorHandler, apiNotFound } from './middleware/errorHandler.mjs';
import { taskStats } from './services/taskManager.mjs';
import itemsRouter from './routes/items.mjs';
import combineRouter from './routes/combine.mjs';
import historyRouter from './routes/history.mjs';
import communityRouter from './routes/community.mjs';

const __dirname = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PORT = process.env.PORT || 8787;

const app = express();
app.disable('x-powered-by');

// ===== 全局中间件 =====
app.use(requestLogger());                       // 请求日志：方法/路径/状态码/耗时
app.use(cors());
app.set('trust proxy', true);                   // 反代场景下 req.ip 取真实来源
app.use(express.json({ limit: '1mb' }));       // JSON 请求体

// ===== API 路由 =====

// 健康检查：服务状态 + Key 配置 + 任务统计
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    key_configured: Boolean(process.env.XYQ_ACCESS_KEY),
    tasks: taskStats(),
    uptime_s: Math.round(process.uptime()),
  });
});

// 奇物库
app.use('/api/items', itemsRouter);

// 组合生成（异步任务 + 旧同步兼容）
app.use('/api/combine', combineRouter);

// 生成历史
app.use('/api/history', historyRouter);

// 社区：图纸上传走原始字节流，先于 JSON 解析之后单独挂 raw
app.use('/api/community/uploads', express.raw({ type: 'application/octet-stream', limit: '20mb' }));
app.use('/api/community', communityRouter);

// API 404 兜底 + 统一错误处理（错误统一输出 JSON，必须放在 API 路由之后）
app.use('/api', apiNotFound);
app.use(errorHandler);

// ===== 静态资源 =====

// 生成的效果图缓存目录（小云雀 URL 有时效，落地到本地更稳）
const PUBLIC_DIR = path.join(__dirname, 'public');
const GEN_DIR = path.join(PUBLIC_DIR, 'generated');
fs.mkdirSync(GEN_DIR, { recursive: true });
app.use('/generated', express.static(GEN_DIR));

// 前端构建产物（SPA fallback: 所有非 API、非文件的 GET 请求返回 index.html）
// HTML 入口一律 no-cache，避免部署新版本后浏览器仍用旧缓存的 index.html（引用旧 hash JS）导致页面异常
app.use((req, res, next) => {
  if (req.method === 'GET' && !path.extname(req.path)) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(PUBLIC_DIR));
app.get('*', (req, res) => {
  // 带扩展名的路径（.js/.css/.jpg 等）说明是静态资源请求，找不到就 404，
  // 绝不能把 index.html 当 JS/CSS 返回（旧缓存请求旧 hash 文件时会 HTML 当 JS 执行导致页面崩溃）
  if (path.extname(req.path)) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  // SPA 路由：HTML 入口禁用缓存，确保浏览器每次都拿到最新版本（避免部署后旧缓存挡住新页面）
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`wonder-forge server listening on http://localhost:${PORT}`);
  console.log(`[xyq] key_configured=${Boolean(process.env.XYQ_ACCESS_KEY)}`);
});
