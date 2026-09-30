// 生成历史路由：服务端持久化历史（前端历史面板的数据源）
import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.mjs';
import { listHistory, getHistory, removeHistory, clearHistory } from '../services/historyStore.mjs';

const router = Router();

// GET /api/history?limit=20 -> 最近历史
router.get('/', asyncHandler(async (req, res) => {
  res.json(await listHistory(req.query.limit));
}));

// GET /api/history/:id -> 单条详情
router.get('/:id', asyncHandler(async (req, res) => {
  const record = await getHistory(req.params.id);
  if (!record) return res.status(404).json({ error: '历史记录不存在' });
  res.json(record);
}));

// DELETE /api/history/:id -> 删除单条
router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await removeHistory(req.params.id);
  if (!ok) return res.status(404).json({ error: '历史记录不存在' });
  res.json({ ok: true });
}));

// DELETE /api/history -> 清空全部
router.delete('/', asyncHandler(async (_req, res) => {
  await clearHistory();
  res.json({ ok: true });
}));

export default router;
