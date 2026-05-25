import { WebSocketServer, WebSocket } from "ws";
import { createWebSocketRateLimiter } from "./rateLimiter.js";

const wsLimiter = createWebSocketRateLimiter({
  connection: {
    points: 10,
    duration: 60,
  },
  message: {
    points: 15,
    duration: 1,
  },
  maxConnectionsPerIP: 3,
});

const matchSubscribers = new Map();
const redisSubscribedMatches = new Set();

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
the web socket. Also injects Redis pub/sub for distributed messaging
*/
export function attachWebSocketServer(server, { publisher, subscriber }) {
  const wss = new WebSocketServer({
    server,
    path: "/ws",
    maxPayload: 1024 * 1024,
  });

  // Handle Redis messages from other instances
  subscriber.on("message", (channel, message) => {
    try {
      const payload = JSON.parse(message);

      if (channel === "matches:broadcast") {
        // Broadcast to all connected clients
        broadcastToAll(wss, payload);
      } else if (channel.startsWith("match:") && channel.endsWith(":commentary")) {
        // Extract matchId from channel name (e.g., "match:123:commentary" -> 123)
        const matchId = parseInt(channel.slice(6, -11), 10);
        // Broadcast only to subscribers of this match
        broadcastToMatch(matchId, payload);
      }
    } catch (err) {
      console.error("Error processing Redis message:", err);
    }
  });

  // Subscribe to broadcast channel from Redis
  subscriber.subscribe("matches:broadcast", (err) => {
    if (err) {
      console.error("Failed to subscribe to matches:broadcast:", err);
    }
  });

  wss.on("connection", async (socket, req) => {
    const allowed = await wsLimiter.onConnection(socket, req);
    if (!allowed) return;
    socket.subscriptions = new Set();
    socket.isAlive = true;

    socket.on("pong", () => {
      socket.isAlive = true;
    });

    socket.on("close", () => {
      wsLimiter.onClose(socket);
      cleanupSubscriptions(socket);
    });

    sendJson(socket, { type: "Welcome" });

    socket.on("message", async (data) => {
      const allowed = await wsLimiter.onMessage(socket);
      if (!allowed) {
        sendJson(socket, {
          type: "error",
          message: "Rate limit for messages exceeded",
        });
        return;
      }

      try {
        const message = JSON.parse(data.toString());

        if (message?.type === "subscribe" && Number.isInteger(message.matchId)) {
          const matchId = message.matchId;
          const channel = `match:${matchId}:commentary`;

          subscribe(matchId, socket);
          socket.subscriptions.add(matchId);

          // Subscribe to Redis channel if not already subscribed
          if (!redisSubscribedMatches.has(matchId)) {
            redisSubscribedMatches.add(matchId);
            subscriber.subscribe(channel, (err) => {
              if (err) {
                console.error(`Failed to subscribe to ${channel}:`, err);
              }
            });
          }

          sendJson(socket, { type: "subscribed", matchId });
          return;
        }

        if (message?.type === "unsubscribe" && Number.isInteger(message.matchId)) {
          const matchId = message.matchId;
          unsubscribe(matchId, socket);
          socket.subscriptions.delete(matchId);

          // Unsubscribe from Redis channel if no local subscribers left
          if (!matchSubscribers.has(matchId)) {
            const channel = `match:${matchId}:commentary`;
            redisSubscribedMatches.delete(matchId);
            subscriber.unsubscribe(channel, (err) => {
              if (err) {
                console.error(`Failed to unsubscribe from ${channel}:`, err);
              }
            });
          }

          sendJson(socket, { type: "unsubscribed", matchId });
          return;
        }

        // Handle other message types if needed
        handleMessage(socket, data);
      } catch {
        sendJson(socket, { type: "error", message: "Invalid JSON" });
      }
    });

    socket.on("error", (err) => {
      console.error("Websocket error", err);
      socket.terminate();
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
    const payload = { type: "match_created", data: match };
    broadcastToAll(wss, payload);
    // Publish to Redis so other instances also broadcast
    publisher.publish("matches:broadcast", JSON.stringify(payload));
  }

  function broadcastCommentary(matchId, comment) {
    const payload = { type: "commentary", data: comment };
    broadcastToMatch(matchId, payload);
    // Publish to Redis so other instances also broadcast
    publisher.publish(
      `match:${matchId}:commentary`,
      JSON.stringify(payload)
    );
  }

  return {
    broadcastMatchCreated,
    broadcastCommentary,
  };
}
