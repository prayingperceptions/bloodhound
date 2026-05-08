import app from "./app";
import { logger } from "./lib/logger";
import { db, huntsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// On startup, any hunt still marked "running" has no live process behind it
// (the server restarted mid-hunt). Mark them failed so users can retry.
async function recoverOrphanedHunts(): Promise<void> {
  try {
    const orphaned = await db
      .update(huntsTable)
      .set({
        status: "failed",
        errorMessage: "Hunt interrupted — server restarted mid-run. Please retry.",
        updatedAt: new Date(),
      })
      .where(eq(huntsTable.status, "running"))
      .returning({ id: huntsTable.id, repoName: huntsTable.repoName });

    if (orphaned.length > 0) {
      logger.warn(
        { count: orphaned.length, hunts: orphaned.map((h) => h.repoName) },
        "Marked orphaned running hunts as failed"
      );
    }
  } catch (err) {
    logger.error({ err }, "Failed to recover orphaned hunts on startup");
  }
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  recoverOrphanedHunts();
});
