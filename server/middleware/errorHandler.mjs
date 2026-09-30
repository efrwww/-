// 自定义验证错误：带字段名与状态码，由 errorHandler 统一输出
export class ValidationError extends Error {
  constructor(message, field, status = 400) {
    super(message);
    this.name = 'ValidationError';
    this.field = field;
    this.status = status;
  }
}

// 包装异步路由：Express 4 不会自动捕获 async 抛出的 rejection
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// 统一错误处理（必须在所有路由之后、静态服务之前注册）
// 输出格式统一为 { error: string, field?: string }
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  if (status >= 500) {
    console.error(`[err] ${req.method} ${req.originalUrl} ->`, err);
  }
  if (res.headersSent) {
    return; // 响应已开始写入，交给 Express 默认逻辑收尾
  }
  const payload = { error: err.message || '服务器内部错误' };
  if (err.field) payload.field = err.field;
  res.status(status).json(payload);
}

// API 404 兜底：/api 下未匹配的路径返回 JSON 而不是 SPA index.html
export function apiNotFound(req, res) {
  res.status(404).json({ error: `接口不存在：${req.method} ${req.originalUrl}` });
}
