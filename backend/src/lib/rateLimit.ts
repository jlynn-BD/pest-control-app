import type { NextFunction, Request, Response } from "express";

// In-memory sliding-window limiter, keyed by client IP. The API runs as one
// instance, so this is enough to blunt password/code guessing; the per-account
// lockout and per-challenge attempt caps in the auth routes are the real
// brake and survive restarts (they live in the database).
export function rateLimit(opts: { windowMs: number; max: number; message?: string }) {
  const hits = new Map<string, number[]>();
  setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [k, v] of hits) {
      const kept = v.filter((t) => t > cutoff);
      if (kept.length) hits.set(k, kept);
      else hits.delete(k);
    }
  }, opts.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip || "unknown";
    const recent = (hits.get(key) ?? []).filter((t) => t > now - opts.windowMs);
    if (recent.length >= opts.max) {
      res.setHeader("Retry-After", Math.ceil(opts.windowMs / 1000).toString());
      res.status(429).json({ error: opts.message ?? "Too many attempts. Please wait a few minutes and try again." });
      return;
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}
