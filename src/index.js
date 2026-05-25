import "dotenv/config";
import express from "express";
import http from "http";
import { matchRouter } from "./routes/matches.js";
import { commentaryRouter } from "./routes/commentary.js";
import { attachWebSocketServer } from "./ws/server.js";
import { connectRedis, publisher, subscriber } from "./redis/client.js";

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "Sport Master API is running" });
});

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

async function startServer() {
  try {
    // Connect to Redis
    await connectRedis();

    // Attach WebSocket with Redis pub/sub
    const { broadcastMatchCreated, broadcastCommentary } =
      attachWebSocketServer(server, { publisher, subscriber });
    app.locals.broadcastMatchCreated = broadcastMatchCreated;
    app.locals.broadcastCommentary = broadcastCommentary;

    server.listen(PORT, HOST, () => {
      const baseURL =
        HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
      console.log(`Server is running on ${baseURL}`);
      console.log(
        `Websocket server is running on ${baseURL.replace("http", "ws")}/ws`,
      );
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
