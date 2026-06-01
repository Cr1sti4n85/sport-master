import { RateLimiterMemory } from "rate-limiter-flexible";

function defaultGetIP(req) {
  return req.socket?.remoteAddress || "unknown";
}

export function createWebSocketRateLimiter({
  connection = {
    points: 10,
    duration: 60,
  },
  message = {
    points: 20,
    duration: 1,
  },
  maxConnectionsPerIP = 3,
  getClientId = defaultGetIP,
} = {}) {
  const connectionLimiter = new RateLimiterMemory(connection);
  const messageLimiter = new RateLimiterMemory(message);

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

  async function onMessage(socket) {
    const key = socket._rateLimitKey;
    if (!key) return false;

    try {
      await messageLimiter.consume(key);
      return true;
    } catch {
      return false;
    }
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
    onMessage,
  };
}
