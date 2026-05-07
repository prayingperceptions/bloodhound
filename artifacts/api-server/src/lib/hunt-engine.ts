import { db, huntsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
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

    // Phase 1: Fetch Solidity files
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

    const { findings, reportMarkdown } = await analyzeWithAI(
      allContracts,
      anomalies,
      hunt.repoName,
      hunt.mode as "code4rena" | "immunefi",
      hunt.model ?? "anthropic/claude-sonnet-4"
    );

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
