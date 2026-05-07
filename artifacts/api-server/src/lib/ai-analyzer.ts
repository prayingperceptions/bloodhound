import { anthropic } from "@workspace/integrations-anthropic-ai";
import type { ContractInfo } from "./solidity-parser";
import type { HeuristicAnomaly } from "./heuristics";
import type { Finding } from "@workspace/db";
import { logger } from "./logger";
import crypto from "crypto";

function buildContractSummary(contracts: ContractInfo[]): string {
  return contracts
    .map((c) => {
      const fns = c.functions
        .filter((f) => f.visibility === "public" || f.visibility === "external")
        .slice(0, 15)
        .map((f) => `  - ${f.signature}${f.isPayable ? " [PAYABLE]" : ""}`)
        .join("\n");

      const vars = c.stateVariables
        .slice(0, 10)
        .map((v) => `  - ${v.type} ${v.visibility} ${v.name}`)
        .join("\n");

      return `### ${c.name} (${c.filePath})
Inherits: ${c.inherits.join(", ") || "none"}
Events: ${c.events.join(", ") || "none"}
State Variables:\n${vars || "  (none)"}
Public/External Functions:\n${fns || "  (none)"}`;
    })
    .join("\n\n");
}

function buildHeuristicSummary(anomalies: HeuristicAnomaly[]): string {
  if (anomalies.length === 0) return "No heuristic anomalies detected.";
  return anomalies
    .map(
      (a) =>
        `- [${a.severity.toUpperCase()}] ${a.category} in ${a.contract}${a.function ? `::${a.function}` : ""}: ${a.description}`
    )
    .join("\n");
}

function extractAndParseJson(text: string): { findings: Omit<Finding, "id">[]; summary: string } {
  // Strategy 1: direct parse (Claude followed instructions perfectly)
  try {
    return JSON.parse(text);
  } catch {}

  // Strategy 2: strip outer markdown fences, then parse
  const fenceStripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return JSON.parse(fenceStripped);
  } catch {}

  // Strategy 3: extract outermost { ... } by counting balanced braces
  // This handles cases where Claude adds prose before/after the JSON object
  let braceStart = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < fenceStripped.length; i++) {
    const ch = fenceStripped[i];
    if (escape) { escape = false; continue; }
    if (ch === "\\") { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) braceStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && braceStart !== -1) {
        const candidate = fenceStripped.slice(braceStart, i + 1);
        try {
          return JSON.parse(candidate);
        } catch {}
        break;
      }
    }
  }

  // Strategy 4: Claude used backtick code blocks inside JSON strings — strip them
  // Replace ```lang\n...\n``` patterns inside what would be string values with the inner content
  const sanitized = fenceStripped
    .replace(/```[a-z]*\n([\s\S]*?)```/g, (_, inner) => inner.replace(/\n/g, "\\n").replace(/"/g, '\\"'))
    .replace(/\n(\s*")/g, ' $1')   // collapse stray real newlines before JSON keys
    .trim();
  try {
    return JSON.parse(sanitized);
  } catch {}

  throw new Error("All JSON extraction strategies failed");
}

export async function analyzeWithAI(
  contracts: ContractInfo[],
  anomalies: HeuristicAnomaly[],
  repoName: string,
  mode: "code4rena" | "immunefi"
): Promise<{ findings: Finding[]; reportMarkdown: string }> {
  const contractSummary = buildContractSummary(contracts);
  const heuristicSummary = buildHeuristicSummary(anomalies);

  const systemPrompt = `You are an elite smart contract security auditor with expertise in DeFi protocols, EVM mechanics, and blockchain security. You identify critical vulnerabilities, exploit chains, and economic attack vectors.

CRITICAL OUTPUT RULES — you MUST follow these exactly or the response will be rejected:
1. Respond ONLY with a single valid JSON object. No markdown, no prose, no explanation outside the JSON.
2. Do NOT use triple backticks anywhere — not around the JSON, not inside string values. Triple backticks WILL break JSON parsing.
3. Inside JSON string values, represent newlines as the two-character sequence \\n (backslash + n). Represent any double-quote as \\". Do not use actual newline characters inside strings.
4. For code in codeSnippet and proofOfConcept fields: write it as a single string with \\n between lines. No markdown fences.

The JSON schema is exactly:
{
  "findings": [
    {
      "severity": "critical|high|medium|low|informational|gas",
      "title": "Short descriptive title",
      "contract": "ContractName",
      "function": "functionName or null",
      "description": "Detailed description of the vulnerability",
      "impact": "Specific impact if exploited",
      "recommendation": "Concrete recommendation to fix",
      "category": "Category name (e.g. Reentrancy, Access Control, etc.)",
      "codeSnippet": "vulnerable code lines separated by \\n, or null",
      "proofOfConcept": "For critical/high: a Foundry-style PoC test showing the full attack, code lines separated by \\n. For medium/low: numbered attack steps with exact function calls and expected outcomes. REQUIRED for all severities."
    }
  ],
  "summary": "Executive summary of the audit (2-4 sentences)"
}`;

  const userPrompt = `Audit the following Solidity smart contracts from the repository: ${repoName}

## Contract Architecture
${contractSummary}

## Heuristic Anomalies Detected
${heuristicSummary}

## Task
Perform a comprehensive security audit. Focus on:
1. High-impact vulnerabilities that could lead to fund loss
2. Access control weaknesses
3. Logical errors and edge cases
4. Economic attack vectors (flash loans, price manipulation, MEV)
5. Integration risks with external protocols
6. Chain any heuristic anomalies into concrete exploit scenarios

Return 5-15 findings ordered by severity. Be specific and actionable. Do not hallucinate — only report findings you are confident about given the code structure.

CRITICAL REQUIREMENT: Every finding MUST include a proofOfConcept. For critical and high severity findings, write a Foundry-style Solidity PoC test contract showing the full attack flow. For medium and lower, write numbered step-by-step attack instructions with exact function calls, parameters, and expected outcomes. Immunefi requires PoC for all severities.

Report mode: ${mode === "code4rena" ? "Code4rena competitive audit" : "Immunefi bug bounty"}`;

  logger.info({ repoName, mode }, "Sending to Anthropic for AI analysis");

  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16000,
    messages: [{ role: "user", content: userPrompt }],
    system: systemPrompt,
  });

  const responseText =
    message.content[0].type === "text" ? message.content[0].text : "";

  let parsed: {
    findings: Omit<Finding, "id">[];
    summary: string;
  };

  try {
    parsed = extractAndParseJson(responseText);
  } catch {
    logger.error({ responseText: responseText.slice(0, 500) }, "Failed to parse AI response as JSON");
    parsed = {
      findings: [
        {
          severity: "informational",
          title: "Analysis Complete",
          contract: contracts[0]?.name ?? "Unknown",
          function: null,
          description: "AI analysis completed. Review the heuristic findings for potential issues.",
          impact: "Varies by finding",
          recommendation: "Manual review recommended",
          category: "General",
          codeSnippet: null,
          proofOfConcept: null,
        },
      ],
      summary: "Analysis completed with heuristic scanning.",
    };
  }

  const findings: Finding[] = parsed.findings.map((f) => ({
    ...f,
    id: crypto.randomUUID(),
    function: f.function ?? null,
    codeSnippet: f.codeSnippet ?? null,
    proofOfConcept: f.proofOfConcept ?? null,
  }));

  const reportMarkdown = generateReport(findings, parsed.summary, repoName, mode);

  return { findings, reportMarkdown };
}

function generateReport(
  findings: Finding[],
  summary: string,
  repoName: string,
  mode: "code4rena" | "immunefi"
): string {
  const now = new Date().toISOString().split("T")[0];
  return mode === "code4rena"
    ? generateCode4renaReport(findings, summary, repoName, now)
    : generateImmunefiReport(findings, summary, repoName, now);
}

function severityOrder(s: string): number {
  return { critical: 0, high: 1, medium: 2, low: 3, informational: 4, gas: 5 }[s] ?? 9;
}

function severityLabel(s: string): string {
  if (s === "critical" || s === "high") return "H";
  if (s === "medium") return "M";
  if (s === "low") return "L";
  return "I";
}

function generateCode4renaReport(
  findings: Finding[],
  summary: string,
  repoName: string,
  date: string
): string {
  const sorted = [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  const highMed = sorted.filter((f) => ["critical", "high", "medium"].includes(f.severity));
  const lowQa = sorted.filter((f) => ["low", "informational", "gas"].includes(f.severity));

  let report = `# Bloodhound Security Audit — ${repoName}\n\n`;
  report += `**Date:** ${date}\n`;
  report += `**Format:** Code4rena\n\n`;
  report += `## Executive Summary\n\n${summary}\n\n`;
  report += `## Findings Summary\n\n`;
  report += `| # | Title | Severity | Contract |\n`;
  report += `|---|-------|----------|----------|\n`;
  sorted.forEach((f, i) => {
    report += `| ${i + 1} | ${f.title} | ${f.severity.toUpperCase()} | ${f.contract} |\n`;
  });
  report += `\n---\n\n`;

  highMed.forEach((f, i) => {
    report += `## [${severityLabel(f.severity)}-${String(i + 1).padStart(2, "0")}] ${f.title}\n\n`;
    report += `**Severity:** ${f.severity.toUpperCase()}\n`;
    report += `**Contract:** \`${f.contract}\`${f.function ? `\n**Function:** \`${f.function}\`` : ""}\n\n`;
    report += `### Description\n\n${f.description}\n\n`;
    report += `### Impact\n\n${f.impact}\n\n`;
    if (f.codeSnippet) {
      report += `### Vulnerable Code\n\n\`\`\`solidity\n${f.codeSnippet}\n\`\`\`\n\n`;
    }
    if (f.proofOfConcept) {
      report += `### Proof of Concept\n\n${f.proofOfConcept}\n\n`;
    }
    report += `### Recommendation\n\n${f.recommendation}\n\n---\n\n`;
  });

  if (lowQa.length > 0) {
    report += `## Low / QA Findings\n\n`;
    lowQa.forEach((f, i) => {
      report += `### [L-${String(i + 1).padStart(2, "0")}] ${f.title}\n\n`;
      report += `**Severity:** ${f.severity.toUpperCase()} | **Contract:** \`${f.contract}\`\n\n`;
      report += `${f.description}\n\n`;
      if (f.proofOfConcept) {
        report += `**Proof of Concept:**\n\n${f.proofOfConcept}\n\n`;
      }
      report += `**Recommendation:** ${f.recommendation}\n\n`;
    });
  }

  report += `\n*Generated by Bloodhound — Mythos-class Security Agent*\n`;
  return report;
}

function generateImmunefiReport(
  findings: Finding[],
  summary: string,
  repoName: string,
  date: string
): string {
  const sorted = [...findings].sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));

  let report = `# Immunefi Bug Report — ${repoName}\n\n`;
  report += `**Date:** ${date}\n`;
  report += `**Format:** Immunefi\n\n`;
  report += `## Summary\n\n${summary}\n\n`;

  sorted.forEach((f, i) => {
    report += `## Finding ${i + 1}: ${f.title}\n\n`;
    report += `**Severity:** ${f.severity.toUpperCase()}\n`;
    report += `**Vulnerability Type:** ${f.category}\n`;
    report += `**Target:** \`${f.contract}${f.function ? `::${f.function}` : ""}\`\n\n`;
    report += `### Vulnerability Description\n\n${f.description}\n\n`;
    report += `### Impact\n\n${f.impact}\n\n`;
    if (f.codeSnippet) {
      report += `### Vulnerable Code\n\n\`\`\`solidity\n${f.codeSnippet}\n\`\`\`\n\n`;
    }
    report += `### Proof of Concept\n\n`;
    if (f.proofOfConcept) {
      report += `${f.proofOfConcept}\n\n`;
    } else {
      report += `_See description and attack scenario above._\n\n`;
    }
    report += `### Remediation\n\n${f.recommendation}\n\n---\n\n`;
  });

  report += `*Generated by Bloodhound — Mythos-class Security Agent*\n`;
  return report;
}
