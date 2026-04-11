import { z } from "zod";

export const listCommentaryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

export const createCommentarySchema = z.object({
  minute: z.number().int().nonnegative(),
  sequence: z.number().int().optional(),
  period: z.string().trim().min(1).optional(),
  eventType: z.string().trim().min(1).optional(),
  actor: z.string().trim().min(1).optional(),
  team: z.string().trim().min(1).optional(),
  message: z.string().trim().min(1),
  metadata: z.record(z.string(), z.any()).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
});
