import { WebSocketServer, WebSocket } from "ws";
import { RateLimiterMemory } from "rate-limiter-flexible";

const activeConnections = new Map();
const connectionLimiter = new RateLimiterMemory({
  points: 10,
  duration: 60,
});

function getIP(req) {
  return req.socket.remoteAddress;
}

export function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

export function broadcast(wss, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }
    client.send(JSON.stringify(payload));
  }
}

/*
this receives the express http server and passes it into
the web socket
*/
export function attachWebSocketServer(server) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  wss.on("connection", async (socket, req) => {
    const ip = getIP(req);

    //limit simultaneous connection by ip
    const count = activeConnections.get(ip) || 0;
    if (count > 3) {
      socket.close(1008, "Too many active connections");
      return;
    }
    activeConnections.set(ip, count + 1);

    try {
      await connectionLimiter.consume(ip);
    } catch {
      socket.close(1008, "Too many connections");
      return;
    }
    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    sendJson(socket, { type: "Welcome" });
    socket.on("error", console.error);
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    const current = activeConnections.get(ip) || 1;
    activeConnections.set(ip, Math.max(0, current - 1));
    clearInterval(interval);
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: "match_created", data: match });
  }

  return {
    broadcastMatchCreated,
  };
}
