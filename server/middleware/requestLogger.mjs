// 统一请求日志：方法、路径、状态码、耗时
export function requestLogger() {
  return (req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
    });
    next();
  };
}
