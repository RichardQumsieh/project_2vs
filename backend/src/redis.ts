import Redis from "ioredis";
import { env } from "./env.js";

const RedisCtor = Redis as unknown as new (url?: string, options?: object) => any;
const redisOptions = {
	maxRetriesPerRequest: null,
	retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000),
};

export const redis = new RedisCtor(env.REDIS_URL, redisOptions);
export const redisSub = new RedisCtor(env.REDIS_URL, redisOptions);

redis.on("error", () => undefined);
redisSub.on("error", () => undefined);
