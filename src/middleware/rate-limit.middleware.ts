import type { RequestHandler } from "express";
import { env } from "../config/env.js";

type RateLimitBucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, RateLimitBucket>();

/**
 * Purge expired buckets to prevent unbounded Map growth.
 * Called on every request — runs in O(n) only when needed.
 */
const purgeExpired = (now: number): void => {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
    }
  }
};

export const rateLimitMiddleware: RequestHandler = (request, response, next) => {
  const now = Date.now();
  const key = request.ip ?? "unknown";

  // Periodically sweep expired entries (every ~100 requests is fine for
  // a single-instance server; swap for Redis when scaling horizontally).
  if (buckets.size > 500) {
    purgeExpired(now);
  }

  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + env.rateLimitWindowMs,
    });
    return next();
  }

  bucket.count += 1;

  if (bucket.count > env.rateLimitMaxRequests) {
    return response.status(429).json({
      error: {
        message: "Too many requests",
        statusCode: 429,
      },
    });
  }

  return next();
};
