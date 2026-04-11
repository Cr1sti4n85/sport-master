import { WebSocketServer, WebSocket } from "ws";
import { createWebSocketRateLimiter } from "./rateLimiter.js";

const wsLimiter = createWebSocketRateLimiter({
  points: 10, //ten conns/min
  duration: 60,
  maxConnectionsPerIP: 3, //max symultaneous
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

    //
    const allowed = await wsLimiter.onConnection(socket, req);
    if (!allowed) return;

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      wsLimiter.onClose(socket);
    });

    socket.on("error", console.error);
    sendJson(socket, { type: "Welcome" });
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  function broadcastMatchCreated(match) {
    broadcast(wss, { type: "match_created", data: match });
  }

  return {
    broadcastMatchCreated,
  };
}
