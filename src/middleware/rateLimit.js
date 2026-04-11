import { RateLimiterMemory } from "rate-limiter-flexible";

const rateLimiter = new RateLimiterMemory({
  points: 20,
  duration: 1,
});

function getClientId(req) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export const rateLimitMiddleware = async (req, res, next) => {
  const key = getClientId(req);

  try {
    await rateLimiter.consume(key);
    return next();
  } catch (rejRes) {
    if (typeof rejRes?.msBeforeNext === "number") {
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: Math.ceil(rejRes.msBeforeNext / 1000),
      });
    }

    return next(rejRes);
  }
};
