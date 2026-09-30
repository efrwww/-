// 奇物库路由
import { Router } from 'express';
import { getItems, CATEGORY_KEYS } from '../services/itemsStore.mjs';

const router = Router();

// GET /api/items                  -> 全量 { daily_items, hardware_parts, ai_modules }
// GET /api/items?category=ai_modules -> 只返回该分类数组
router.get('/', (req, res) => {
  const { category } = req.query;
  const items = getItems();
  if (category) {
    if (!CATEGORY_KEYS.includes(category)) {
      return res.status(400).json({
        error: `分类不存在：${category}（可选：${CATEGORY_KEYS.join(' / ')}）`,
        field: 'category',
      });
    }
    return res.json({ category, list: items[category] });
  }
  res.json(items);
});

export default router;
