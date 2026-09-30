// 奇物库数据源：启动时一次性加载到内存（静态数据，无热更新需求）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ITEMS_PATH = path.join(__dirname, '..', '..', 'data', 'items.json');

export const CATEGORY_KEYS = ['daily_items', 'hardware_parts', 'ai_modules'];

let cache = null;

function load() {
  if (!cache) {
    cache = JSON.parse(fs.readFileSync(ITEMS_PATH, 'utf8'));
  }
  return cache;
}

// 全量奇物库：{ daily_items: [], hardware_parts: [], ai_modules: [] }
export function getItems() {
  return load();
}

// 按 ID 精确查找：返回 { item, category } 或 null
export function findItem(id) {
  const items = load();
  for (const category of CATEGORY_KEYS) {
    const list = items[category] || [];
    const hit = list.find((x) => x.id === id);
    if (hit) return { item: hit, category };
  }
  return null;
}
