// 生成历史持久化：JSON 文件 + 原子写入（tmp + rename），无外部依赖
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HISTORY_PATH = path.join(__dirname, '..', '..', 'data', 'history.json');
const MAX_HISTORY = 100; // 最多保留条数，超出丢弃最旧的

async function readAll() {
  try {
    const list = JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

async function writeAll(list) {
  // 原子写：先写临时文件再 rename，避免写一半崩溃导致 JSON 损坏
  const tempFile = `${HISTORY_PATH}.${randomUUID()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(list, null, 2), 'utf8');
  await fs.rename(tempFile, HISTORY_PATH);
}

// 追加一条历史（自动裁剪到上限），返回完整记录
export async function addHistory({ selection, result }) {
  const list = await readAll();
  const record = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    selection: {
      daily_ids: selection.daily_ids,
      hardware_ids: selection.hardware_ids,
      ai_ids: selection.ai_ids,
      idea: selection.idea || '',
    },
    result,
  };
  list.unshift(record);
  if (list.length > MAX_HISTORY) list.length = MAX_HISTORY;
  await writeAll(list);
  return record;
}

// 最近历史（默认 20 条）
export async function listHistory(limit = 20) {
  const list = await readAll();
  const n = Math.max(1, Math.min(100, Number(limit) || 20));
  return list.slice(0, n);
}

export async function getHistory(id) {
  const list = await readAll();
  return list.find((x) => x.id === id) || null;
}

export async function removeHistory(id) {
  const list = await readAll();
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  await writeAll(next);
  return true;
}

export async function clearHistory() {
  await writeAll([]);
}
