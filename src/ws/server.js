import { WebSocketServer, WebSocket } from "ws";
import { createWebSocketRateLimiter } from "./rateLimiter.js";

const wsLimiter = createWebSocketRateLimiter({
  points: 10, //ten conns/min
  duration: 60,
  maxConnectionsPerIP: 3, //max symultaneous
});

const matchSubscribers = new Map();

//utils
export function sendJson(socket, payload) {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

//subscribe/unsubscribe
function subscribe(matchId, socket) {
  if (!matchSubscribers.has(matchId)) {
    matchSubscribers.set(matchId, new Set());
  }
  matchSubscribers.get(matchId).add(socket);
}

function unsubscribe(matchId, socket) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers) return;
  subscribers.delete(socket);
  if (subscribers.size === 0) {
    matchSubscribers.delete(matchId);
  }
}

function cleanupSubscriptions(socket) {
  for (const matchId of socket.subscriptions) {
    unsubscribe(matchId, socket);
  }
  socket.subscriptions.clear();
}

//broadcasts
function broadcastToMatch(matchId, payload) {
  const subscribers = matchSubscribers.get(matchId);
  if (!subscribers || subscribers.size === 0) return;

  const message = JSON.stringify(payload);
  for (const subscriber of subscribers) {
    if (subscriber.readyState === WebSocket.OPEN) {
      subscriber.send(message);
    }
  }
}

export function broadcastToAll(wss, payload) {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }
    client.send(JSON.stringify(payload));
  }
}

//handlers
function handleMessage(socket, data) {
  try {
    const message = JSON.parse(data.toString());
    if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
      subscribe(message.matchId, socket);
      socket.subscriptions.add(message.matchId);
      sendJson(socket, { type: "subscribed", matchId: message.matchId });
      return;
    }
    if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
      unsubscribe(message.matchId, socket);
      socket.subscriptions.delete(message.matchId);
      sendJson(socket, { type: "unsubscribed", matchId: message.matchId });
    }
  } catch {
    sendJson(socket, { type: "error", message: "Invalid JSON" });
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
    const allowed = await wsLimiter.onConnection(socket, req);
    if (!allowed) return;

    socket.isAlive = true;
    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      wsLimiter.onClose(socket);
      cleanupSubscriptions(socket);
    });

    socket.subscriptions = new Set();

    sendJson(socket, { type: "Welcome" });

    socket.on("message", (data) => {
      handleMessage(socket, data);
    });

    socket.on("error", () => {
      socket.terminate();
      console.error;
    });
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
    broadcastToAll(wss, { type: "match_created", data: match });
  }

  function broadcastCommentary(matchId, comment) {
    broadcastToMatch(matchId, { type: "commentary", data: comment });
  }

  return {
    broadcastMatchCreated,
    broadcastCommentary,
  };
}
