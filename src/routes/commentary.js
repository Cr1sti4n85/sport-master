import { Router } from "express";
import { eq, desc } from "drizzle-orm";
import { db } from "../db/db.js";
import { commentary, matches } from "../db/schema.js";
import { matchIdParamSchema } from "../validation/matches.js";
import { rateLimitMiddleware } from "../middleware/rateLimit.js";
import {
  createCommentarySchema,
  listCommentaryQuerySchema,
} from "../validation/commentary.js";

export const commentaryRouter = Router({ mergeParams: true });

commentaryRouter.use(rateLimitMiddleware);

commentaryRouter.post("/", async (req, res) => {
  const paramsResult = matchIdParamSchema.safeParse(req.params);

  if (!paramsResult.success) {
    return res.status(400).json({
      error: "Invalid match ID",
      details: paramsResult.error.issues,
    });
  }

  const bodyResult = createCommentarySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).json({
      error: "Invalid payload",
      details: bodyResult.error.issues,
    });
  }

  try {
    const [matchRow] = await db
      .select({ id: matches.id })
      .from(matches)
      .where(eq(matches.id, paramsResult.data.id))
      .limit(1);

    if (!matchRow) {
      return res.status(404).json({ error: "Match not found" });
    }
    const { minute, ...rest } = bodyResult.data;
    const [result] = await db
      .insert(commentary)
      .values({
        matchId: paramsResult.data.id,
        minute,
        ...rest,
      })
      .returning();

    if (typeof res.app.locals.broadcastCommentary === "function") {
      try {
        res.app.locals.broadcastCommentary(result.matchId, result);
      } catch (wsError) {
        console.error("Failed to broadcast commentary", wsError);
      }
    }

    res.status(201).json({
      data: result,
    });
  } catch (error) {
    console.error("Failed to create commentary", error);
    res.status(500).json({ error: "Failed to create commentary" });
  }
});

commentaryRouter.get("/", async (req, res) => {
  const paramsResult = matchIdParamSchema.safeParse(req.params);

  if (!paramsResult.success) {
    return res.status(400).json({
      error: "Invalid match ID",
      details: paramsResult.error.issues,
    });
  }

  const queryResults = listCommentaryQuerySchema.safeParse(req.query);

  if (!queryResults.success) {
    return res.status(400).json({
      error: "Invalid query parameters",
      details: queryResults.error.issues,
    });
  }

  try {
    const { limit = 10 } = queryResults.data;
    const data = await db
      .select()
      .from(commentary)
      .where(eq(commentary.matchId, paramsResult.data.id))
      .orderBy(desc(commentary.createdAt))
      .limit(limit);

    res.status(200).json({ data });
  } catch (error) {
    console.error("Failed to fetch commentary", error);
    res.status(500).json({ error: "Failed to fetch commentary" });
  }
});
