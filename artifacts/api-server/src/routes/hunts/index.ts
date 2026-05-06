import { Router, type IRouter } from "express";
import { eq, desc, count, sql } from "drizzle-orm";
import { db, huntsTable } from "@workspace/db";
import {
  CreateHuntBody,
  GetHuntParams,
  GetHuntProgressParams,
  ListHuntsResponse,
  GetHuntResponse,
  GetHuntStatsResponse,
} from "@workspace/api-zod";
import { runHunt, addProgressListener, removeProgressListener } from "../../lib/hunt-engine";
import { extractRepoName } from "../../lib/github";
import { logger } from "../../lib/logger";
import crypto from "crypto";

const router: IRouter = Router();

// GET /hunts
router.get("/hunts", async (req, res): Promise<void> => {
  const hunts = await db
    .select()
    .from(huntsTable)
    .orderBy(desc(huntsTable.createdAt))
    .limit(50);

  res.json(ListHuntsResponse.parse(hunts));
});

// GET /hunts/stats — must be before /hunts/:id
router.get("/hunts/stats", async (req, res): Promise<void> => {
  const [stats] = await db
    .select({
      totalHunts: count(),
    })
    .from(huntsTable);

  const [completed] = await db
    .select({ count: count() })
    .from(huntsTable)
    .where(eq(huntsTable.status, "complete"));

  const allFindings = await db
    .select({ findings: huntsTable.findings })
    .from(huntsTable)
    .where(eq(huntsTable.status, "complete"));

  let totalFindings = 0;
  let criticalFindings = 0;
  let highFindings = 0;

  for (const row of allFindings) {
    const findings = (row.findings as { severity: string }[] | null) ?? [];
    totalFindings += findings.length;
    criticalFindings += findings.filter((f) => f.severity === "critical").length;
    highFindings += findings.filter((f) => f.severity === "high").length;
  }

  const recentHunts = await db
    .select()
    .from(huntsTable)
    .orderBy(desc(huntsTable.createdAt))
    .limit(5);

  res.json(
    GetHuntStatsResponse.parse({
      totalHunts: stats?.totalHunts ?? 0,
      completedHunts: completed?.count ?? 0,
      totalFindings,
      criticalFindings,
      highFindings,
      recentHunts,
    })
  );
});

// POST /hunts
router.post("/hunts", async (req, res): Promise<void> => {
  const parsed = CreateHuntBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { repoUrl, mode } = parsed.data;
  const repoName = extractRepoName(repoUrl);
  const id = crypto.randomUUID();

  const [hunt] = await db
    .insert(huntsTable)
    .values({
      id,
      repoUrl,
      repoName,
      mode,
      status: "pending",
    })
    .returning();

  req.log.info({ huntId: id, repoUrl }, "Hunt created");

  // Run async (don't await)
  runHunt(id).catch((err) => {
    logger.error({ huntId: id, err }, "Uncaught hunt error");
  });

  res.status(201).json(GetHuntResponse.parse(hunt));
});

// GET /hunts/:id
router.get("/hunts/:id", async (req, res): Promise<void> => {
  const params = GetHuntParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [hunt] = await db
    .select()
    .from(huntsTable)
    .where(eq(huntsTable.id, params.data.id));

  if (!hunt) {
    res.status(404).json({ error: "Hunt not found" });
    return;
  }

  res.json(GetHuntResponse.parse(hunt));
});

// GET /hunts/:id/progress — SSE stream
router.get("/hunts/:id/progress", async (req, res): Promise<void> => {
  const params = GetHuntProgressParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const huntId = params.data.id;

  // Verify hunt exists
  const [hunt] = await db
    .select()
    .from(huntsTable)
    .where(eq(huntsTable.id, huntId));

  if (!hunt) {
    res.status(404).json({ error: "Hunt not found" });
    return;
  }

  // If already complete/failed, send final event immediately
  if (hunt.status === "complete" || hunt.status === "failed") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.write(
      `data: ${JSON.stringify({
        phase: hunt.status,
        message: hunt.status === "complete" ? "Hunt already complete" : hunt.errorMessage ?? "Hunt failed",
        progress: hunt.status === "complete" ? 100 : 0,
        done: true,
      })}\n\n`
    );
    res.end();
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send keep-alive
  const keepAlive = setInterval(() => {
    res.write(": keep-alive\n\n");
  }, 15_000);

  const listener = (event: { phase: string; message: string; progress?: number }) => {
    const isDone = event.phase === "complete" || event.phase === "error";
    res.write(`data: ${JSON.stringify({ ...event, done: isDone })}\n\n`);
    if (isDone) {
      clearInterval(keepAlive);
      removeProgressListener(huntId, listener);
      res.end();
    }
  };

  addProgressListener(huntId, listener);

  req.on("close", () => {
    clearInterval(keepAlive);
    removeProgressListener(huntId, listener);
  });
});

export default router;
