// 社区路由：构想列表/发起/助力/图纸上传（自 server/community.mjs 迁移并接入统一验证层）
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { createRateLimiter } from '../middleware/rateLimit.mjs';
import { validateCommunityPost, validateHelpBody, UPLOAD_EXTENSIONS } from '../middleware/validate.mjs';
import { asyncHandler } from '../middleware/errorHandler.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataFile = path.join(__dirname, '..', '..', 'data', 'community.json');
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');

// 防刷限流：写入类操作每 IP 每分钟最多 30 次
const writeLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 30, message: '操作过于频繁' });
// 上传限流：每 IP 每分钟最多 10 个文件
const uploadLimiter = createRateLimiter({ windowMs: 60 * 1000, max: 10, message: '上传过于频繁' });

const seedProjects = [
  {
    id: 'p1', title: '夜光记忆杯', creator: '小北',
    goal: '给爷爷留下的马克杯涂上夜光荧光粉，夜里放在床头就像他还在陪着我',
    combos: ['陶瓷马克杯', '夜光荧光粉'], status: '组装中',
    contributions: [
      { who: '阿深', type: '加模组', text: '建议加一个记忆相册模组' },
      { who: '灯工坊', type: '改 3D 图纸', text: '建议给杯托预留底部灯槽' },
    ],
  },
  {
    id: 'p2', title: '时光电话', creator: '阿遥',
    goal: '把奶奶的声音克隆进老电话机，拿起听筒就能和她说说话',
    combos: ['老式旋转电话机', '声音克隆', 'AI 对话'], status: '效果图已生成',
    contributions: [],
  },
  {
    id: 'p3', title: '心愿病房', creator: '安',
    goal: '让病床上的妈妈听到爸爸亲口说一句「我爱你」',
    combos: ['AI 视频分身', '声音模组', '信息提取'], status: '征集中',
    contributions: [],
  },
];

async function readProjects() {
  try {
    const projects = JSON.parse(await fs.readFile(dataFile, 'utf8'));
    return projects.length ? projects : seedProjects;
  } catch (error) {
    if (error.code === 'ENOENT') return seedProjects;
    throw error;
  }
}

async function writeProjects(projects) {
  // 原子写：tmp + rename，避免写一半崩溃导致 JSON 损坏
  const tempFile = `${dataFile}.${randomUUID()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(projects, null, 2), 'utf8');
  await fs.rename(tempFile, dataFile);
}

const router = Router();

// GET /api/community -> 构想列表
router.get('/', asyncHandler(async (_req, res) => {
  res.json(await readProjects());
}));

// POST /api/community -> 发起构想
router.post('/', writeLimiter, asyncHandler(async (req, res) => {
  const { title, goal } = validateCommunityPost(req.body);
  const projects = await readProjects();
  projects.unshift({
    id: randomUUID(), title, goal, creator: '我', combos: [],
    status: '征集中', contributions: [],
  });
  await writeProjects(projects);
  res.status(201).json(projects);
}));

// POST /api/community/:id/help -> 提交助力
router.post('/:id/help', writeLimiter, asyncHandler(async (req, res) => {
  const { type, text, attachment } = validateHelpBody(req.body);
  const projects = await readProjects();
  const project = projects.find((item) => item.id === req.params.id);
  if (!project) return res.status(404).json({ error: '构想不存在' });
  project.contributions.push({ who: '我', type, text, attachment: attachment || null });
  await writeProjects(projects);
  res.status(201).json(projects);
}));

// 二进制图纸流不走 express.json，在挂载点由 index.mjs 以 raw 模式解析
// POST /api/community/uploads -> 上传 3D 图纸（原始字节 + X-File-Name 头）
router.post('/uploads', uploadLimiter, asyncHandler(async (req, res) => {
  const originalName = path.basename(decodeURIComponent(String(req.get('X-File-Name') || '')));
  const extension = path.extname(originalName).toLowerCase();
  if (!UPLOAD_EXTENSIONS.includes(extension)) {
    return res.status(400).json({ error: `仅支持 ${UPLOAD_EXTENSIONS.join('、')} 图纸` });
  }
  if (!req.body?.length) {
    return res.status(400).json({ error: '文件内容为空' });
  }
  await fs.mkdir(uploadDir, { recursive: true });
  const filename = `${randomUUID()}${extension}`;
  await fs.writeFile(path.join(uploadDir, filename), req.body);
  res.status(201).json({ name: originalName, url: `/uploads/${filename}` });
}));

export default router;
