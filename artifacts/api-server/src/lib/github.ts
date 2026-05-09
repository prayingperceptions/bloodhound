import { logger } from "./logger";

export interface SolidityFile {
  path: string;
  content: string;
  name: string;
}

function parseGithubUrl(url: string): { owner: string; repo: string; ref?: string } | null {
  try {
    const u = new URL(url);
    // Only accept github.com over HTTPS — reject any other host or scheme
    if (u.protocol !== "https:" || (u.hostname !== "github.com" && u.hostname !== "www.github.com")) {
      return null;
    }
    const parts = u.pathname.replace(/^\//, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/, "");
    // Sanitize: only allow alphanumeric, hyphen, underscore, dot
    if (!/^[a-zA-Z0-9._-]+$/.test(owner) || !/^[a-zA-Z0-9._-]+$/.test(repo)) return null;
    const ref = parts[3]; // tree/main => parts[2]=tree, parts[3]=branch
    return { owner, repo, ref };
  } catch {
    return null;
  }
}

const MAX_SOL_FILES = 50;
const MAX_REPO_SOL_FILES = 300;
// Per-request timeouts — generous but bounded
const API_TIMEOUT_MS = 20_000;   // GitHub API calls
const FILE_TIMEOUT_MS = 15_000;  // raw file downloads
// Concurrent file downloads — cap at 10 to avoid overwhelming rate limits
const FETCH_CONCURRENCY = 10;

async function fetchGithubApi(url: string): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "bloodhound-security-agent",
  };
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(API_TIMEOUT_MS),
  });
  if (!res.ok) {
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 403 && remaining === "0") {
      throw new Error("GitHub API rate limit exceeded. Try again later.");
    }
    throw new Error(`GitHub API error ${res.status}: ${url}`);
  }
  return res.json();
}

async function getDefaultBranch(owner: string, repo: string): Promise<string> {
  const data = (await fetchGithubApi(
    `https://api.github.com/repos/${owner}/${repo}`
  )) as { default_branch: string };
  return data.default_branch ?? "main";
}

interface GithubTreeItem {
  path: string;
  type: string;
  sha: string;
  size?: number;
  url: string;
}

interface GithubTree {
  tree: GithubTreeItem[];
  truncated?: boolean;
}

// Fetch files in batches of FETCH_CONCURRENCY to avoid hanging on 50 parallel connections
async function fetchInBatches(
  items: GithubTreeItem[],
  owner: string,
  repo: string,
  branch: string
): Promise<SolidityFile[]> {
  const results: SolidityFile[] = [];

  for (let i = 0; i < items.length; i += FETCH_CONCURRENCY) {
    const batch = items.slice(i, i + FETCH_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map(async (file) => {
        const raw = await fetch(
          `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`,
          { signal: AbortSignal.timeout(FILE_TIMEOUT_MS) }
        );
        if (!raw.ok) throw new Error(`HTTP ${raw.status}`);
        const content = await raw.text();
        return {
          path: file.path,
          name: file.path.split("/").pop() ?? file.path,
          content,
        };
      })
    );

    for (let j = 0; j < settled.length; j++) {
      const r = settled[j];
      if (r.status === "fulfilled") {
        results.push(r.value);
      } else {
        logger.warn({ path: batch[j]!.path, reason: String(r.reason) }, "Skipped file — fetch failed/timed out");
      }
    }
  }

  return results;
}

export async function fetchSolidityFiles(repoUrl: string): Promise<SolidityFile[]> {
  const parsed = parseGithubUrl(repoUrl);
  if (!parsed) {
    throw new Error(`Invalid GitHub URL: ${repoUrl}`);
  }

  const { owner, repo } = parsed;
  const branch = parsed.ref ?? (await getDefaultBranch(owner, repo));

  logger.info({ owner, repo, branch }, "Fetching Solidity files from GitHub");

  const tree = (await fetchGithubApi(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`
  )) as GithubTree;

  if (tree.truncated) {
    logger.warn({ owner, repo }, "GitHub tree response was truncated — very large repo");
  }

  const solFiles = tree.tree.filter(
    (item) =>
      item.type === "blob" &&
      item.path.endsWith(".sol") &&
      !item.path.includes("node_modules") &&
      !item.path.includes("lib/forge-std") &&
      !item.path.includes("lib/openzeppelin") &&
      !item.path.includes(".t.sol") &&
      (item.size ?? 0) < 500_000
  );

  logger.info({ count: solFiles.length }, "Found Solidity files");

  if (solFiles.length === 0) {
    throw new Error("No Solidity files found in repository");
  }

  if (solFiles.length > MAX_REPO_SOL_FILES) {
    throw new Error(
      `Repository has ${solFiles.length} Solidity files — too large to audit (limit: ${MAX_REPO_SOL_FILES}). Try linking to a specific subdirectory or branch.`
    );
  }

  // Fetch up to MAX_SOL_FILES files in batches with per-file timeouts
  const filesToFetch = solFiles.slice(0, MAX_SOL_FILES);
  const results = await fetchInBatches(filesToFetch, owner, repo, branch);

  logger.info({ fetched: results.length, attempted: filesToFetch.length }, "File fetch complete");

  if (results.length === 0) {
    throw new Error("Failed to download any Solidity files — check network or repo access.");
  }

  return results;
}

export function extractRepoName(repoUrl: string): string {
  try {
    const u = new URL(repoUrl);
    const parts = u.pathname.replace(/^\//, "").split("/");
    return parts.slice(0, 2).join("/");
  } catch {
    return repoUrl;
  }
}
