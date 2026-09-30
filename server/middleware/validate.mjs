// 统一输入验证层：所有外部输入在这里完成类型、真实性、长度、枚举校验
import { ValidationError } from './errorHandler.mjs';
import { findItem, CATEGORY_KEYS } from '../services/itemsStore.mjs';

// 请求体必须是对象
export function requireObject(body, field = 'body') {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ValidationError('请求体必须是 JSON 对象', field);
  }
  return body;
}

// 组合请求字段 -> 期望的奇物库分类
const SELECTION_FIELDS = {
  daily_ids: 'daily_items',
  hardware_ids: 'hardware_parts',
  ai_ids: 'ai_modules',
};

const MAX_SELECTION = 8;   // 单次组合上限（防止 prompt 过长）
const MAX_IDEA_LENGTH = 500;

// 组合生成入参验证：
// 1. 各 *_ids 必须是字符串数组
// 2. 每个 ID 必须真实存在于奇物库，且分类匹配（修复“无效 ID 静默过滤”问题）
// 3. 至少选 1 件、总计不超过 8 件、自动去重
// 4. idea 可选，纯文本，最长 500 字
export function validateCombineSelection(body) {
  requireObject(body);
  const selection = { daily_ids: [], hardware_ids: [], ai_ids: [], idea: '' };

  for (const [field, expectCategory] of Object.entries(SELECTION_FIELDS)) {
    const raw = body[field];
    if (raw === undefined || raw === null) continue;
    if (!Array.isArray(raw)) {
      throw new ValidationError(`${field} 必须是数组`, field);
    }
    for (const id of raw) {
      if (typeof id !== 'string' || !id.trim()) {
        throw new ValidationError('物品或模组 ID 必须是非空字符串', field);
      }
      const cleanId = id.trim();
      const found = findItem(cleanId);
      if (!found) {
        throw new ValidationError(`物品或模组不存在：${cleanId}`, field);
      }
      if (found.category !== expectCategory) {
        throw new ValidationError(`「${found.item.name}」不属于该分类，请到对应分类下选择`, field);
      }
      if (!selection[field].includes(cleanId)) selection[field].push(cleanId);
    }
  }

  const total = selection.daily_ids.length + selection.hardware_ids.length + selection.ai_ids.length;
  if (!total) {
    throw new ValidationError('请至少选择一件物品或模组', 'selection');
  }
  if (total > MAX_SELECTION) {
    throw new ValidationError(`一次最多组合 ${MAX_SELECTION} 件（物品/部件/模组合计）`, 'selection');
  }

  if (body.idea !== undefined && body.idea !== null) {
    if (typeof body.idea !== 'string') {
      throw new ValidationError('预期效果必须是文本', 'idea');
    }
    const idea = body.idea.trim();
    if (idea.length > MAX_IDEA_LENGTH) {
      throw new ValidationError(`预期效果最多 ${MAX_IDEA_LENGTH} 字`, 'idea');
    }
    selection.idea = idea;
  }
  return selection;
}

const MAX_TITLE = 80;
const MAX_GOAL = 1000;
const MAX_HELP_TEXT = 1000;
export const HELP_TYPES = ['加模组', '改 3D 图纸', '提方案', '供物料'];

// 社区：发起构想
export function validateCommunityPost(body) {
  requireObject(body);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const goal = typeof body.goal === 'string' ? body.goal.trim() : '';
  if (!title) throw new ValidationError('请填写构想标题', 'title');
  if (title.length > MAX_TITLE) throw new ValidationError(`标题最多 ${MAX_TITLE} 字`, 'title');
  if (!goal) throw new ValidationError('请填写预期目标', 'goal');
  if (goal.length > MAX_GOAL) throw new ValidationError(`预期目标最多 ${MAX_GOAL} 字`, 'goal');
  return { title, goal };
}

// 社区：提交助力（type 枚举 + text/attachment 至少一项）
export function validateHelpBody(body) {
  requireObject(body);
  const type = typeof body.type === 'string' ? body.type.trim() : '';
  if (!HELP_TYPES.includes(type)) {
    throw new ValidationError(`助力类型必须是：${HELP_TYPES.join(' / ')}`, 'type');
  }
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (text.length > MAX_HELP_TEXT) {
    throw new ValidationError(`助力内容最多 ${MAX_HELP_TEXT} 字`, 'text');
  }
  const attachment = body.attachment || null;
  if (attachment) {
    if (typeof attachment !== 'object' || typeof attachment.name !== 'string' ||
        typeof attachment.url !== 'string' || !attachment.url.startsWith('/uploads/')) {
      throw new ValidationError('附件格式不正确，请重新上传图纸', 'attachment');
    }
  }
  if (!text && !attachment) {
    throw new ValidationError('请填写助力内容或上传图纸', 'text');
  }
  return { type, text, attachment };
}

// 上传图纸扩展名白名单
export const UPLOAD_EXTENSIONS = ['.stl', '.step', '.stp', '.3mf', '.obj'];
