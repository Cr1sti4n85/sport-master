import "dotenv/config";
import express from "express";
import http from "http";
import { matchRouter } from "./routes/matches.js";
import { commentaryRouter } from "./routes/commentary.js";
import { attachWebSocketServer } from "./ws/server.js";
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || "0.0.0.0";

const app = express();
const server = http.createServer(app);

const replicaApp = process.env.APP_NAME

app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: `Request served by ${replicaApp}` });
});

app.use("/matches", matchRouter);
app.use("/matches/:id/commentary", commentaryRouter);

const { broadcastMatchCreated, broadcastCommentary } =
  attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;
app.locals.broadcastCommentary = broadcastCommentary;

server.listen(PORT, HOST, () => {
  const baseURL =
    HOST === "0.0.0.0" ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(` ${replicaApp} is running on ${baseURL}`);
  console.log(
    `Websocket server is running on ${baseURL.replace("http", "ws")}/ws`,
  );
});
