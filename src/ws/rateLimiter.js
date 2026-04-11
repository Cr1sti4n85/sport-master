import { RateLimiterMemory } from "rate-limiter-flexible";

function defaultGetIP(req) {
  return (
    req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown"
  );
}

export function createWebSocketRateLimiter({
  points = 10,
  duration = 60,
  maxConnectionsPerIP = 3,
  getClientId = defaultGetIP,
} = {}) {
  const connectionLimiter = new RateLimiterMemory({
    points,
    duration,
  });

  const activeConnections = new Map();

  async function onConnection(socket, req) {
    const key = getClientId(req);

    try {
      await connectionLimiter.consume(key);
    } catch {
      socket.close(1008, "Too many connection attempts");
      return false;
    }

    const current = activeConnections.get(key) || 0;

    if (current >= maxConnectionsPerIP) {
      socket.close(1008, "Too many active connections");
      return false;
    }

    activeConnections.set(key, current + 1);

    // attach key al socket para usarlo en close
    socket._rateLimitKey = key;

    return true;
  }

  function onClose(socket) {
    const key = socket._rateLimitKey;
    if (!key) return;

    const current = activeConnections.get(key) || 1;
    const next = Math.max(0, current - 1);

    if (next === 0) {
      activeConnections.delete(key);
    } else {
      activeConnections.set(key, next);
    }
  }

  return {
    onConnection,
    onClose,
  };
}
