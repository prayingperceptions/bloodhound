import type { ContractInfo, FunctionInfo } from "./solidity-parser";

export interface HeuristicAnomaly {
  contract: string;
  function?: string;
  category: string;
  description: string;
  severity: "critical" | "high" | "medium" | "low" | "informational";
  codeSnippet?: string;
}

function checkReentrancy(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    const body = fn.body.toLowerCase();
    // Look for external calls before state changes
    const hasExternalCall =
      body.includes(".call{") ||
      body.includes(".call(") ||
      body.includes(".transfer(") ||
      body.includes(".send(");

    if (!hasExternalCall) continue;

    const hasStateChange =
      body.includes("balance") ||
      body.includes("balances[") ||
      body.includes("= 0") ||
      body.includes("-=");

    const hasNonReentrantGuard =
      fn.modifiers.some((m) => m.toLowerCase().includes("reentr")) ||
      body.includes("nonreentrant") ||
      body.includes("_status") ||
      body.includes("locked");

    if (hasStateChange && !hasNonReentrantGuard) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Reentrancy",
        description: `Function \`${fn.name}\` in \`${contract.name}\` makes external calls while modifying state variables, potentially vulnerable to reentrancy attacks.`,
        severity: "high",
        codeSnippet: fn.body.slice(0, 500),
      });
    }
  }

  return anomalies;
}

function checkAccessControl(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  const sensitivePatterns = [
    "withdraw",
    "mint",
    "burn",
    "pause",
    "upgrade",
    "setowner",
    "initialize",
    "execute",
    "transferownership",
    "emergencywithdraw",
  ];

  for (const fn of contract.functions) {
    if (fn.visibility !== "public" && fn.visibility !== "external") continue;

    const nameLower = fn.name.toLowerCase();
    const isSensitive = sensitivePatterns.some((p) => nameLower.includes(p));

    if (!isSensitive) continue;

    const hasAccessControl =
      fn.modifiers.length > 0 ||
      fn.body.toLowerCase().includes("require(msg.sender") ||
      fn.body.toLowerCase().includes("onlyowner") ||
      fn.body.toLowerCase().includes("hasrole") ||
      fn.body.toLowerCase().includes("_checkowner");

    if (!hasAccessControl) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Access Control",
        description: `Public/external function \`${fn.name}\` in \`${contract.name}\` appears to lack access control for a sensitive operation.`,
        severity: "high",
        codeSnippet: fn.signature,
      });
    }
  }

  return anomalies;
}

function checkIntegerOverflow(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  // Look for unchecked blocks with arithmetic
  for (const fn of contract.functions) {
    const body = fn.body;
    if (body.includes("unchecked") && (body.includes("+") || body.includes("-") || body.includes("*"))) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Integer Overflow/Underflow",
        description: `Function \`${fn.name}\` uses \`unchecked\` arithmetic, which bypasses Solidity 0.8+ overflow protection. Verify all arithmetic is safe.`,
        severity: "medium",
        codeSnippet: fn.body.slice(0, 300),
      });
    }
  }

  return anomalies;
}

function checkTxOrigin(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    if (fn.body.includes("tx.origin")) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "tx.origin Authentication",
        description: `Function \`${fn.name}\` uses \`tx.origin\` for authentication, which is vulnerable to phishing attacks. Use \`msg.sender\` instead.`,
        severity: "high",
        codeSnippet: fn.body.slice(0, 300),
      });
    }
  }

  return anomalies;
}

function checkFrontRunning(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    const body = fn.body.toLowerCase();
    const hasPrice = body.includes("price") || body.includes("rate") || body.includes("slippage");
    const hasDeadline = body.includes("deadline") || body.includes("minout") || body.includes("minamount");

    if (hasPrice && !hasDeadline && fn.isPayable) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Front-Running",
        description: `Function \`${fn.name}\` handles price-sensitive operations without deadline or slippage protection, potentially vulnerable to MEV/front-running.`,
        severity: "medium",
        codeSnippet: fn.signature,
      });
    }
  }

  return anomalies;
}

function checkDelegateCall(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    if (fn.body.includes("delegatecall")) {
      const isProtected =
        fn.body.toLowerCase().includes("require(msg.sender") ||
        fn.modifiers.length > 0;

      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Delegatecall",
        description: `Function \`${fn.name}\` uses \`delegatecall\`, which executes code in the context of the calling contract. Storage layout compatibility and call target validation are critical.`,
        severity: isProtected ? "medium" : "high",
        codeSnippet: fn.body.slice(0, 400),
      });
    }
  }

  return anomalies;
}

function checkOracleManipulation(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    const body = fn.body.toLowerCase();
    const usesSpotPrice =
      body.includes("getreserves") ||
      body.includes("slot0") ||
      (body.includes("balanceof") && (body.includes("price") || body.includes("ratio")));

    const hasTwap = body.includes("twap") || body.includes("observe") || body.includes("consult");

    if (usesSpotPrice && !hasTwap) {
      anomalies.push({
        contract: contract.name,
        function: fn.name,
        category: "Oracle Manipulation",
        description: `Function \`${fn.name}\` appears to use spot price from AMM reserves without TWAP protection, vulnerable to flash loan price manipulation.`,
        severity: "high",
        codeSnippet: fn.body.slice(0, 400),
      });
    }
  }

  return anomalies;
}

function checkUnprotectedInitializer(contract: ContractInfo): HeuristicAnomaly[] {
  const anomalies: HeuristicAnomaly[] = [];

  for (const fn of contract.functions) {
    const nameLower = fn.name.toLowerCase();
    if (nameLower === "initialize" || nameLower.startsWith("initialize")) {
      const hasInitializer =
        fn.modifiers.some((m) => m.toLowerCase().includes("initializ")) ||
        fn.body.toLowerCase().includes("_initializing") ||
        fn.body.toLowerCase().includes("initialized");

      if (!hasInitializer) {
        anomalies.push({
          contract: contract.name,
          function: fn.name,
          category: "Unprotected Initializer",
          description: `Initializer function \`${fn.name}\` in \`${contract.name}\` may lack the \`initializer\` modifier or re-entrancy protection, allowing it to be called multiple times.`,
          severity: "critical",
          codeSnippet: fn.signature,
        });
      }
    }
  }

  return anomalies;
}

export function runHeuristics(contracts: ContractInfo[]): HeuristicAnomaly[] {
  const allAnomalies: HeuristicAnomaly[] = [];

  for (const contract of contracts) {
    allAnomalies.push(
      ...checkReentrancy(contract),
      ...checkAccessControl(contract),
      ...checkIntegerOverflow(contract),
      ...checkTxOrigin(contract),
      ...checkFrontRunning(contract),
      ...checkDelegateCall(contract),
      ...checkOracleManipulation(contract),
      ...checkUnprotectedInitializer(contract)
    );
  }

  return allAnomalies;
}
