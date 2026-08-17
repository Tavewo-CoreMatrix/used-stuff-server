import { env } from "../config/env.js";

// Parses the REDIS_URL into a plain options object.
// Passing a plain object (not a Redis instance) to BullMQ avoids the
// "two ioredis versions" type conflict — BullMQ creates its own connection internally.
export const getRedisOptions = () => {
  const url = new URL(env.redisUrl);
  const isTLS = url.protocol === "rediss:";

  return {
    host: url.hostname,
    port: Number(url.port) || (isTLS ? 6380 : 6379),
    username: url.username || undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    maxRetriesPerRequest: null as null,
    enableReadyCheck: false,
    ...(isTLS && { tls: { rejectUnauthorized: false } }),
  };
};
