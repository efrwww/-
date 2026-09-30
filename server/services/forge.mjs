// 组合生成业务：构建 prompt -> 调小云雀 -> 轮询 -> 解析方案 + 缓存效果图
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { submitRun, getThread, runState, extractEntries, collectText, collectImageUrls } from './xyq.mjs';
import { getItems } from './itemsStore.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GENERATED_DIR = path.join(__dirname, '..', 'public', 'generated');

export class CancelledError extends Error {
  constructor() {
    super('任务已取消');
    this.name = 'CancelledError';
  }
}

// 小云雀返回的图片 URL 有时效，落地到本地更稳
async function cacheImages(urls) {
  await fs.promises.mkdir(GENERATED_DIR, { recursive: true });
  return Promise.all(urls.map(async (url) => {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) return url;
      const type = response.headers.get('content-type')?.split(';')[0];
      const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
      if (!extensions[type]) return url;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 12 * 1024 * 1024) return url;
      const filename = `${randomUUID()}.${extensions[type]}`;
      await fs.promises.writeFile(path.join(GENERATED_DIR, filename), bytes);
      return `/generated/${filename}`;
    } catch {
      return url; // 缓存失败就退回原始 URL
    }
  }));
}

export function loadItems() {
  return getItems();
}

export function buildPrompt(selection) {
  const items = loadItems();
  const lookup = (id, list) => list.find((x) => x.id === id);
  const daily = (selection.daily_ids || []).map((id) => lookup(id, items.daily_items)).filter(Boolean);
  const parts = (selection.hardware_ids || []).map((id) => lookup(id, items.hardware_parts)).filter(Boolean);
  const modules = (selection.ai_ids || []).map((id) => lookup(id, items.ai_modules)).filter(Boolean);

  const fmt = (x) => `${x.name}（${x.desc}）`;
  const lines = [];
  if (daily.length) lines.push(`日常物品：${daily.map(fmt).join('、')}`);
  if (parts.length) lines.push(`功能部件：${parts.map(fmt).join('、')}`);
  if (modules.length) lines.push(`AI 模组：${modules.map(fmt).join('、')}`);
  lines.push(`用户期望：${selection.idea || '未填写，请自由发挥'}`);

  return `你是「万物改造工坊」的新产品设计师。请把下面这些日常物品、功能部件和 AI 模组组合成一款有意义的新产品。` +
    `要求：1) 给产品起一个有记忆点的中文名；2) 写一段 80 字以内的产品介绍；3) 列出核心玩法（2-3 条）；` +
    `4) 列出材料清单；5) 给出组装步骤（3-5 步）；6) 生成一张该产品的照片级效果图（重点表现材质、光效与发光质感，` +
    `图中不要出现任何文字、水印、logo）。请先用 JSON 回复：` +
    `{"name":"产品名","intro":"产品介绍","play":["玩法1","玩法2"],"materials":["材料1"],` +
    `"steps":["步骤1"],"image_prompt":"英文外观描述"}` +
    `\n\n${lines.join('\n')}`;
}

function parseResult(text) {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) {
    throw new Error('AI 未返回可解析的产品方案，请重试');
  }
  let parsed;
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    throw new Error('AI 返回的方案格式异常，请重试');
  }
  // 关键字段兜底：保证前端一定能渲染
  return {
    name: parsed.name || '未命名新作',
    intro: parsed.intro || '',
    play: Array.isArray(parsed.play) ? parsed.play : [],
    materials: Array.isArray(parsed.materials) ? parsed.materials : [],
    steps: Array.isArray(parsed.steps) ? parsed.steps : [],
    image_prompt: parsed.image_prompt || '',
    raw: parsed.raw || null,
  };
}

async function pollUntilDone(threadId, runId, { onTick, isCancelled } = {}) {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    if (isCancelled?.()) throw new CancelledError();

    const data = await getThread(threadId, runId);
    const current = data?.thread?.run_list?.[0] || {};
    const state = runState(current);
    const entries = extractEntries(current);
    const text = collectText(entries);
    if (onTick) onTick({ state, text: text.slice(0, 2000) });

    if (state === 3) {
      return { current, entries, text, images: collectImageUrls(entries) };
    }
    if (state === 4) {
      throw new Error(`AI 创作失败：${current.fail_reason || '未知原因'}`);
    }
    if (state === 5) {
      throw new Error('AI 创作已取消');
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  throw new Error('AI 生成超时（8 分钟），请重试');
}

// 主流程：options.onTick({state, text}) 上报进度；options.isCancelled() 返回 true 时中止
export async function runCombination(selection, options = {}) {
  const { onTick, isCancelled } = options;
  const message = buildPrompt(selection);

  if (!process.env.XYQ_ACCESS_KEY) {
    throw new Error('小云雀 API Key 未配置，无法生成（请在 server/.env 设置 XYQ_ACCESS_KEY）');
  }

  const first = await submitRun('', message);
  const run = first?.run || {};
  const threadId = run.thread_id || first?.thread_id || '';
  const runId = run.run_id || first?.run_id || '';
  const webThreadLink = first?.web_thread_link || '';
  if (!threadId) throw new Error('AI 服务未返回会话 ID');

  const done = await pollUntilDone(threadId, runId, { onTick, isCancelled });
  let images = done.images;

  // 兜底：第一轮没出图，就拿着 image_prompt 在同一会话里请它生成效果图
  if (!images.length) {
    let imagePrompt = '';
    try {
      imagePrompt = parseResult(done.text).image_prompt || '';
    } catch {
      imagePrompt = '';
    }
    const askImage = imagePrompt
      ? `请生成一张这款产品的照片级效果图，重点是材质、光效与发光质感，图中不要出现文字、水印、logo。外观描述：${imagePrompt}`
      : '请生成一张这款产品的照片级效果图，重点是材质、光效与发光质感，图中不要出现文字、水印、logo。';
    const second = await submitRun(threadId, askImage);
    const secondRunId = second?.run?.run_id || second?.run_id || '';
    const imgDone = await pollUntilDone(threadId, secondRunId, { onTick, isCancelled });
    images = imgDone.images;
  }

  return {
    thread_id: threadId,
    run_id: runId,
    web_thread_link: webThreadLink,
    text: done.text,
    result: parseResult(done.text),
    image_urls: await cacheImages(images),
  };
}
