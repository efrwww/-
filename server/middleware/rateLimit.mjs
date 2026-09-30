// 轻量内存限流（按 IP 令牌桶），无外部依赖
// 用法：app.post('/x', createRateLimiter({ windowMs, max, message }), handler)
export function createRateLimiter({ windowMs = 10 * 60 * 1000, max = 5, message = '请求过于频繁，请稍后再试' } = {}) {
  const buckets = new Map(); // ip -> { count, resetAt }

  return (req, res, next) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();

    let bucket = buckets.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;

    // 桶数过多时顺带清理过期条目，防止内存缓慢增长
    if (buckets.size > 1000) {
      for (const [key, b] of buckets) {
        if (now > b.resetAt) buckets.delete(key);
      }
    }

    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: `${message}（${Math.ceil(retryAfter / 60)} 分钟后重试）` });
    }
    next();
  };
}
