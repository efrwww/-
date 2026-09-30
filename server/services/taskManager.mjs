// 异步任务管理器：组合生成任务的生命周期（创建/进度/取消/超时/清理）
// 内存态存储，重启后任务列表清空（历史结果已由 historyStore 落盘，不丢失）
import { randomUUID } from 'node:crypto';
import { runCombination } from './forge.mjs';
import { addHistory } from './historyStore.mjs';

const TASK_TTL_MS = 30 * 60 * 1000;          // 终态任务保留 30 分钟供查询
const TASK_HARD_TIMEOUT_MS = 10 * 60 * 1000; // 任务硬超时 10 分钟
const MAX_ACTIVE_TASKS = 10;                 // 全局并发上限

const tasks = new Map(); // taskId -> task

export class TaskBusyError extends Error {
  constructor(message, status = 429) {
    super(message);
    this.status = status;
  }
}

function now() { return Date.now(); }

function sweepFinished() {
  for (const [id, t] of tasks) {
    if (t.state !== 'running' && t.finishedAt && now() - t.finishedAt > TASK_TTL_MS) {
      tasks.delete(id);
    }
  }
}

export function countActive() {
  let n = 0;
  for (const t of tasks.values()) if (t.state === 'running') n += 1;
  return n;
}

// 是否已有该 IP 的运行中任务（防重复提交）
export function hasActiveFor(ip) {
  for (const t of tasks.values()) {
    if (t.state === 'running' && t.ip === ip) return t;
  }
  return null;
}

export function taskStats() {
  const stats = { running: 0, done: 0, failed: 0, cancelled: 0 };
  for (const t of tasks.values()) {
    if (stats[t.state] !== undefined) stats[t.state] += 1;
  }
  stats.total = tasks.size;
  return stats;
}

const STAGE_TEXT = {
  0: 'AI 思考中', 1: 'AI 创作中', 2: 'AI 生成中', 3: '完成', 4: '生成失败', 5: '已取消',
};

export function createTask(selection, { ip = 'unknown' } = {}) {
  if (countActive() >= MAX_ACTIVE_TASKS) {
    throw new TaskBusyError('生成任务排队已满，请稍后再试');
  }
  const id = randomUUID();
  const task = {
    id,
    ip,
    state: 'running',
    stage: '正在提交给 AI',
    text: '',           // AI 已生成的部分文本（进度预览）
    result: null,
    error: null,
    historyId: null,
    createdAt: now(),
    finishedAt: null,
    cancelled: false,
  };
  tasks.set(id, task);
  execute(task, selection); // 后台执行，不阻塞响应
  return task;
}

async function execute(task, selection) {
  try {
    const result = await runCombination(selection, {
      onTick: ({ state, text }) => {
        if (task.cancelled) return;
        task.stage = STAGE_TEXT[state] || 'AI 处理中';
        if (text) task.text = text;
      },
      isCancelled: () => task.cancelled,
    });
    if (task.cancelled) {
      task.state = 'cancelled';
      task.stage = '已取消';
    } else {
      task.result = result;
      task.state = 'done';
      task.stage = '完成';
      // 成功后自动落历史库
      try {
        const record = await addHistory({ selection, result });
        task.historyId = record.id;
      } catch (err) {
        console.error('[task] 历史落库失败（不影响任务结果）:', err.message);
      }
    }
  } catch (err) {
    if (task.cancelled) {
      task.state = 'cancelled';
      task.stage = '已取消';
    } else {
      task.state = 'failed';
      task.error = String(err?.message || err);
    }
  } finally {
    task.finishedAt = now();
    sweepFinished();
  }
}

export function getTask(id) {
  return tasks.get(id) || null;
}

// 取消：只置标志位，轮询循环在下一圈感知并中止（最多延迟约 10 秒）
export function cancelTask(id) {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.state === 'running') {
    task.cancelled = true;
    return { ...task, state: 'cancelling' };
  }
  return task;
}

export function listTasks() {
  return [...tasks.values()];
}

// 对外输出视图：隐藏 ip 等内部字段
export function publicTask(t) {
  return {
    task_id: t.id,
    state: t.state,
    stage: t.stage,
    text: (t.text || '').slice(0, 2000),
    error: t.error,
    result: t.result,
    history_id: t.historyId,
    created_at: t.createdAt,
    finished_at: t.finishedAt,
  };
}

// 启动时检查：将超时任务标记（防御性，正常流程用不到）
export function isTimedOut(task) {
  return task.state === 'running' && now() - task.createdAt > TASK_HARD_TIMEOUT_MS;
}
