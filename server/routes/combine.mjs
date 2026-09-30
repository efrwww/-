// 组合生成路由：异步任务模式 + 保留旧同步接口兼容
import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimit.mjs';
import { validateCombineSelection } from '../middleware/validate.mjs';
import { asyncHandler } from '../middleware/errorHandler.mjs';
import { TaskBusyError, createTask, getTask, cancelTask, listTasks, hasActiveFor, publicTask, taskStats } from '../services/taskManager.mjs';
import { runCombination } from '../services/forge.mjs';

const router = Router();

// 提交生成类接口限流：每 IP 每 10 分钟最多 5 次（每次都真实消耗 AI 配额）
const combineLimiter = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5, message: '生成请求过于频繁' });

// ===== 异步任务模式（推荐）=====

// POST /api/combine/async -> 202 { task_id, poll }
router.post('/async', combineLimiter, asyncHandler((req, res) => {
  const selection = validateCombineSelection(req.body);

  // 每 IP 同时只允许 1 个运行中任务，避免重复扣配额
  const running = hasActiveFor(req.ip);
  if (running) {
    return res.status(409).json({
      error: '你已有一个生成任务进行中，请等它完成或先取消',
      task_id: running.id,
    });
  }

  const task = createTask(selection, { ip: req.ip });
  res.status(202).json({ task_id: task.id, poll: `/api/combine/tasks/${task.id}` });
}));

// GET /api/combine/tasks -> 当前任务列表（进度面板用）
router.get('/tasks', (req, res) => {
  res.json(listTasks().map(publicTask));
});

// GET /api/combine/tasks/stats -> 任务统计（健康面板用）
router.get('/tasks/stats', (req, res) => {
  res.json(taskStats());
});

// GET /api/combine/tasks/:id -> 单任务状态/进度/结果
router.get('/tasks/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在或已过期（完成后保留 30 分钟）' });
  res.json(publicTask(task));
});

// DELETE /api/combine/tasks/:id -> 取消任务
router.delete('/tasks/:id', (req, res) => {
  const task = cancelTask(req.params.id);
  if (!task) return res.status(404).json({ error: '任务不存在或已过期' });
  res.json(publicTask(task));
});

// ===== 旧同步接口（保留兼容，前端已切换到 async 模式）=====
// POST /api/combine -> 同步等待完整结果（1-3 分钟，连接断开即丢结果）
router.post('/', combineLimiter, asyncHandler(async (req, res) => {
  const selection = validateCombineSelection(req.body);
  const result = await runCombination(selection);
  res.json(result);
}));

export default router;
