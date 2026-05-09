import { db, huntsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { fetchSolidityFiles } from "./github";
import { parseContract } from "./solidity-parser";
import { runHeuristics } from "./heuristics";
import { analyzeWithAI } from "./ai-analyzer";
import { logger } from "./logger";

type ProgressCallback = (event: {
  phase: string;
  message: string;
  progress?: number;
}) => void;

const progressListeners = new Map<string, ProgressCallback[]>();

export function addProgressListener(huntId: string, cb: ProgressCallback): void {
  const listeners = progressListeners.get(huntId) ?? [];
  listeners.push(cb);
  progressListeners.set(huntId, listeners);
}

export function removeProgressListener(huntId: string, cb: ProgressCallback): void {
  const listeners = progressListeners.get(huntId) ?? [];
  progressListeners.set(
    huntId,
    listeners.filter((l) => l !== cb)
  );
}

function emit(huntId: string, event: { phase: string; message: string; progress?: number }): void {
  const listeners = progressListeners.get(huntId) ?? [];
  for (const cb of listeners) {
    try {
      cb(event);
    } catch {
      // ignore
    }
  }
}

/**
 * On startup: any hunt that was left in "running" state (e.g. server crash
 * mid-hunt) will never complete. Mark them failed so the UI shows the correct state.
 */
export async function recoverOrphanedHunts(): Promise<void> {
  try {
    const orphans = await db
      .select({ id: huntsTable.id })
      .from(huntsTable)
      .where(eq(huntsTable.status, "running"));

    if (orphans.length === 0) return;

    const ids = orphans.map((h) => h.id);
    await db
      .update(huntsTable)
      .set({
        status: "failed",
        errorMessage: "Hunt was interrupted — server restarted while hunt was in progress. Please start a new hunt.",
        updatedAt: new Date(),
      })
      .where(inArray(huntsTable.id, ids));

    logger.warn({ count: ids.length, ids }, "Recovered orphaned running hunts on startup");
  } catch (err) {
    logger.error({ err }, "Failed to recover orphaned hunts on startup");
  }
}

export async function runHunt(huntId: string): Promise<void> {
  logger.info({ huntId }, "Starting hunt");

  try {
    // Mark as running
    const [hunt] = await db
      .update(huntsTable)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(huntsTable.id, huntId))
      .returning();

    if (!hunt) {
      throw new Error(`Hunt ${huntId} not found`);
    }

    emit(huntId, { phase: "shadow", message: "Cloning repository and discovering Solidity files...", progress: 5 });

    // Phase 1: Fetch Solidity files (with per-file timeouts inside fetchSolidityFiles)
    const solidityFiles = await fetchSolidityFiles(hunt.repoUrl);

    emit(huntId, {
      phase: "shadow",
      message: `Found ${solidityFiles.length} Solidity contracts. Parsing...`,
      progress: 20,
    });

    // Phase 2: Parse contracts
    const allContracts = solidityFiles.flatMap((file) =>
      parseContract(file.content, file.path)
    );

    const contractCount = allContracts.length;

    await db
      .update(huntsTable)
      .set({ contractsFound: contractCount, updatedAt: new Date() })
      .where(eq(huntsTable.id, huntId));

    emit(huntId, {
      phase: "detect",
      message: `Parsed ${contractCount} contracts. Running domain heuristics...`,
      progress: 40,
    });

    // Phase 3: Run heuristics
    const anomalies = runHeuristics(allContracts);

    emit(huntId, {
      phase: "detect",
      message: `Detected ${anomalies.length} heuristic anomalies. Chaining exploits with AI...`,
      progress: 55,
    });

    // Phase 4: AI analysis
    emit(huntId, {
      phase: "chain",
      message: "AI reasoning about exploit chains and vulnerabilities...",
      progress: 65,
    });

    // Send heartbeat progress events every 30s so the UI doesn't appear frozen
    let heartbeatProgress = 65;
    const heartbeat = setInterval(() => {
      heartbeatProgress = Math.min(heartbeatProgress + 3, 88);
      emit(huntId, {
        phase: "chain",
        message: "AI deep-analyzing contracts — this can take a few minutes for large repos...",
        progress: heartbeatProgress,
      });
    }, 30_000);

    // Hard 8-minute wall-clock timeout on AI analysis
    const aiTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI analysis timed out after 8 minutes. Try a smaller repo or a specific subdirectory.")), 8 * 60 * 1000)
    );

    let findings: Awaited<ReturnType<typeof analyzeWithAI>>["findings"];
    let reportMarkdown: string;

    try {
      ({ findings, reportMarkdown } = await Promise.race([
        analyzeWithAI(
          allContracts,
          anomalies,
          hunt.repoName,
          hunt.mode as "code4rena" | "immunefi",
          hunt.model ?? "anthropic/claude-sonnet-4"
        ),
        aiTimeout,
      ]));
    } finally {
      clearInterval(heartbeat);
    }

    emit(huntId, {
      phase: "report",
      message: `Generating ${hunt.mode} report...`,
      progress: 90,
    });

    // Phase 5: Save results
    await db
      .update(huntsTable)
      .set({
        status: "complete",
        findings: findings as never,
        reportMarkdown,
        updatedAt: new Date(),
      })
      .where(eq(huntsTable.id, huntId));

    emit(huntId, {
      phase: "complete",
      message: `Hunt complete. Found ${findings.length} vulnerabilities.`,
      progress: 100,
    });

    logger.info({ huntId, findingCount: findings.length }, "Hunt complete");
  } catch (err) {
    logger.error({ huntId, err }, "Hunt failed");
    const errorMessage = err instanceof Error ? err.message : String(err);

    await db
      .update(huntsTable)
      .set({ status: "failed", errorMessage, updatedAt: new Date() })
      .where(eq(huntsTable.id, huntId));

    emit(huntId, {
      phase: "error",
      message: `Hunt failed: ${errorMessage}`,
      progress: 0,
    });
  } finally {
    // Cleanup listeners after a delay
    setTimeout(() => {
      progressListeners.delete(huntId);
    }, 30_000);
  }
}
