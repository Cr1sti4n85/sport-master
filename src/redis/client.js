import { createClient } from "redis";

const REDIS_HOST = process.env.REDIS_HOST || "localhost";
const REDIS_PORT = process.env.REDIS_PORT || 6379;

const publisher = createClient({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

const subscriber = createClient({
  host: REDIS_HOST,
  port: REDIS_PORT,
});

export async function connectRedis() {
  try {
    await publisher.connect();
    await subscriber.connect();
    console.log(`Redis connected to ${REDIS_HOST}:${REDIS_PORT}`);
  } catch (err) {
    console.error("Failed to connect to Redis:", err);
    throw err;
  }
}

export async function disconnectRedis() {
  try {
    await publisher.quit();
    await subscriber.quit();
    console.log("Redis disconnected");
  } catch (err) {
    console.error("Error disconnecting from Redis:", err);
  }
}

export { publisher, subscriber };
