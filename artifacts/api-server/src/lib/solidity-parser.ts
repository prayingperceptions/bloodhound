export interface ContractInfo {
  name: string;
  filePath: string;
  functions: FunctionInfo[];
  stateVariables: StateVariable[];
  events: string[];
  modifiers: string[];
  inherits: string[];
  rawSource: string;
}

export interface FunctionInfo {
  name: string;
  visibility: string;
  modifiers: string[];
  isPayable: boolean;
  isView: boolean;
  isPure: boolean;
  body: string;
  signature: string;
}

export interface StateVariable {
  name: string;
  type: string;
  visibility: string;
  isMapping: boolean;
}

function extractBetweenBraces(source: string, startIdx: number): string {
  let depth = 0;
  let i = startIdx;
  let start = -1;
  while (i < source.length) {
    if (source[i] === "{") {
      depth++;
      if (start === -1) start = i;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        return source.slice(start + 1, i);
      }
    }
    i++;
  }
  return "";
}

export function parseContract(source: string, filePath: string): ContractInfo[] {
  const contracts: ContractInfo[] = [];

  // Match contract/interface/library declarations
  const contractRegex =
    /\b(contract|interface|library|abstract\s+contract)\s+(\w+)(\s+is\s+([^{]+))?\s*\{/g;

  let match;
  while ((match = contractRegex.exec(source)) !== null) {
    const name = match[2];
    const inheritsRaw = match[4] ?? "";
    const inherits = inheritsRaw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const bodyStart = match.index + match[0].length - 1;
    const body = extractBetweenBraces(source, bodyStart);

    // Parse functions
    const functions: FunctionInfo[] = [];
    const funcRegex =
      /function\s+(\w+)\s*\(([^)]*)\)\s*((?:public|private|internal|external|virtual|override|returns\s*\([^)]*\)|payable|view|pure|\w+\s*)*)\s*(?:\{|;)/g;
    let fm;
    while ((fm = funcRegex.exec(body)) !== null) {
      const funcName = fm[1];
      const attrs = fm[3] ?? "";
      const attrLower = attrs.toLowerCase();
      const mods = attrs
        .split(/\s+/)
        .filter(
          (a) =>
            a &&
            !["public", "private", "internal", "external", "virtual", "override", "payable", "view", "pure"].includes(a.toLowerCase()) &&
            !a.startsWith("returns")
        );

      const visibility =
        ["public", "private", "internal", "external"].find((v) =>
          attrLower.includes(v)
        ) ?? "internal";

      // Get function body
      const funcBodyStart = body.indexOf("{", fm.index + fm[0].length - 1);
      const funcBody =
        funcBodyStart !== -1
          ? extractBetweenBraces(body, funcBodyStart)
          : "";

      functions.push({
        name: funcName,
        visibility,
        modifiers: mods,
        isPayable: attrLower.includes("payable"),
        isView: attrLower.includes("view"),
        isPure: attrLower.includes("pure"),
        body: funcBody.slice(0, 2000), // cap for token limits
        signature: `function ${funcName}(${fm[2]}) ${attrs.trim()}`,
      });
    }

    // Parse state variables
    const stateVariables: StateVariable[] = [];
    const stateRegex =
      /^\s*(mapping\s*\([^)]+\)\s*(?:=>?\s*[\w\[\]]+)?|address(?:\s+payable)?|uint\d*|int\d*|bool|bytes\d*|string|bytes)\s+((?:public|private|internal|constant|immutable)\s+)*(\w+)\s*[;=]/gm;
    let sv;
    while ((sv = stateRegex.exec(body)) !== null) {
      const varType = sv[1].trim();
      const varName = sv[3];
      const visRaw = sv[2] ?? "";
      const visibility =
        ["public", "private", "internal"].find((v) =>
          visRaw.includes(v)
        ) ?? "internal";

      stateVariables.push({
        name: varName,
        type: varType,
        visibility,
        isMapping: varType.startsWith("mapping"),
      });
    }

    // Parse events
    const events: string[] = [];
    const eventRegex = /event\s+(\w+)\s*\([^)]*\)/g;
    let ev;
    while ((ev = eventRegex.exec(body)) !== null) {
      events.push(ev[1]);
    }

    // Parse modifiers
    const modifiers: string[] = [];
    const modRegex = /modifier\s+(\w+)\s*\(/g;
    let mod;
    while ((mod = modRegex.exec(body)) !== null) {
      modifiers.push(mod[1]);
    }

    contracts.push({
      name,
      filePath,
      functions,
      stateVariables,
      events,
      modifiers,
      inherits,
      rawSource: body.slice(0, 8000),
    });
  }

  return contracts;
}
