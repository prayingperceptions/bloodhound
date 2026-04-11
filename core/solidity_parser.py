"""
core/solidity_parser.py — Solidity AST parser.

Wraps Slither (primary) or solc --ast-json (fallback) to extract
contract structures, function call graphs, and state variable read/write sets.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from core.state_map import (
    Contract,
    FunctionFlow,
    StateVariable,
)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_contracts(repo_path: str | Path) -> list[Contract]:
    """
    Extract all contracts from a Solidity project.
    
    Tries Slither first; falls back to regex-based parsing if unavailable.
    """
    repo = Path(repo_path)
    sol_files = _find_solidity_files(repo)

    if not sol_files:
        raise FileNotFoundError(f"No .sol files found in {repo}")

    # Try Slither first
    if _slither_available():
        try:
            return _extract_with_slither(repo)
        except Exception as e:
            print(f"[!] Slither failed ({e}), falling back to regex parser.")

    # Fallback: regex-based parser
    return _extract_with_regex(sol_files)


def build_call_graph(contracts: list[Contract]) -> dict[str, list[str]]:
    """
    Build a function-level call graph across all contracts.
    
    Returns: { "Contract.function": ["Contract.callee", ...] }
    """
    graph: dict[str, list[str]] = {}
    for contract in contracts:
        for fn in contract.functions:
            key = f"{contract.name}.{fn.name}"
            callees = []
            for ic in fn.internal_calls:
                callees.append(f"{contract.name}.{ic}")
            for ec in fn.external_calls:
                callees.append(ec)
            graph[key] = callees
    return graph


# ---------------------------------------------------------------------------
# Slither integration
# ---------------------------------------------------------------------------

def _slither_available() -> bool:
    """Check if Slither is installed."""
    try:
        result = subprocess.run(
            ["slither", "--version"],
            capture_output=True, text=True, timeout=10,
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired):
        return False


def _extract_with_slither(repo_path: Path) -> list[Contract]:
    """Extract contracts using Slither's Python API."""
    # Import here to avoid hard dependency
    from slither.slither import Slither  # type: ignore

    slither = Slither(str(repo_path))
    contracts: list[Contract] = []

    for slither_contract in slither.contracts:
        state_vars = []
        for sv in slither_contract.state_variables:
            state_vars.append(StateVariable(
                name=sv.name,
                var_type=str(sv.type),
                visibility=str(sv.visibility),
                is_mapping="mapping" in str(sv.type).lower(),
                is_array="[]" in str(sv.type),
            ))

        functions = []
        for fn in slither_contract.functions:
            if fn.is_constructor:
                fn_name = "constructor"
            else:
                fn_name = fn.name

            reads = [sv.name for sv in fn.state_variables_read]
            writes = [sv.name for sv in fn.state_variables_written]
            internal = [c.name for c in fn.internal_calls if hasattr(c, "name")]
            external = []
            for call_info in fn.high_level_calls:
                if len(call_info) == 2:
                    target_contract, target_fn = call_info
                    external.append(f"{target_contract.name}.{target_fn.name}")

            params = [{"name": p.name, "type": str(p.type)} for p in fn.parameters]
            rets = [{"name": r.name or "", "type": str(r.type)} for r in fn.returns]

            functions.append(FunctionFlow(
                name=fn_name,
                contract=slither_contract.name,
                visibility=str(fn.visibility),
                mutability="payable" if fn.payable else ("view" if fn.view else "nonpayable"),
                modifiers=[m.name for m in fn.modifiers],
                reads=reads,
                writes=writes,
                internal_calls=internal,
                external_calls=external,
                parameters=params,
                returns=rets,
            ))

        contracts.append(Contract(
            name=slither_contract.name,
            file_path=str(slither_contract.source_mapping.filename.relative),
            is_interface=slither_contract.is_interface,
            is_abstract=getattr(slither_contract, "is_abstract", False),
            is_library=slither_contract.is_library,
            inherits=[c.name for c in slither_contract.inheritance],
            state_variables=state_vars,
            functions=functions,
            modifiers=[m.name for m in slither_contract.modifiers],
            events=[e.name for e in slither_contract.events],
        ))

    return contracts


# ---------------------------------------------------------------------------
# Regex-based fallback parser
# ---------------------------------------------------------------------------

# Patterns
_CONTRACT_RE = re.compile(
    r"(interface|abstract\s+contract|library|contract)\s+"
    r"(\w+)"
    r"(?:\s+is\s+([^{]+))?"
    r"\s*\{",
    re.MULTILINE,
)

_FUNCTION_RE = re.compile(
    r"function\s+(\w+)\s*\(([^)]*)\)\s*"
    r"((?:public|external|internal|private|view|pure|payable|virtual|override|"
    r"returns\s*\([^)]*\)|[\w.]+\s*)*)"
    r"\s*(?:returns\s*\(([^)]*)\))?\s*[{;]",
    re.MULTILINE,
)

_STATE_VAR_RE = re.compile(
    r"^\s+(mapping\s*\([^)]+\)|[\w\[\]]+)\s+"
    r"(public|private|internal|external)?\s*"
    r"(\w+)\s*[;=]",
    re.MULTILINE,
)

_MODIFIER_CALL_RE = re.compile(r"\b(onlyOwner|whenNotPaused|nonReentrant|initializer|\w+Guard)\b")

_EXTERNAL_CALL_RE = re.compile(r"(\w+)\.(\w+)\(")

_EVENT_RE = re.compile(r"event\s+(\w+)\s*\(")


def _extract_with_regex(sol_files: list[Path]) -> list[Contract]:
    """Parse Solidity files with regex patterns. Best-effort."""
    contracts: list[Contract] = []

    for fpath in sol_files:
        source = fpath.read_text(encoding="utf-8", errors="replace")
        # Strip comments
        source_clean = _strip_comments(source)

        for m in _CONTRACT_RE.finditer(source_clean):
            kind = m.group(1).strip()
            name = m.group(2)
            inherits_raw = m.group(3)
            inherits = [i.strip() for i in inherits_raw.split(",")] if inherits_raw else []

            # Find the contract body
            body = _extract_body(source_clean, m.end() - 1)

            # State variables
            state_vars = []
            for sv_match in _STATE_VAR_RE.finditer(body):
                var_type = sv_match.group(1).strip()
                visibility = sv_match.group(2) or "internal"
                var_name = sv_match.group(3)
                state_vars.append(StateVariable(
                    name=var_name,
                    var_type=var_type,
                    visibility=visibility,
                    is_mapping=var_type.startswith("mapping"),
                    is_array="[" in var_type,
                ))

            # Functions
            functions = []
            for fn_match in _FUNCTION_RE.finditer(body):
                fn_name = fn_match.group(1)
                params_raw = fn_match.group(2).strip()
                qualifiers = fn_match.group(3) or ""
                returns_raw = fn_match.group(4) or ""

                visibility = "public"
                for v in ("external", "internal", "private", "public"):
                    if v in qualifiers:
                        visibility = v
                        break

                mutability = "nonpayable"
                if "pure" in qualifiers:
                    mutability = "pure"
                elif "view" in qualifiers:
                    mutability = "view"
                elif "payable" in qualifiers:
                    mutability = "payable"

                # Modifiers
                modifiers = _MODIFIER_CALL_RE.findall(qualifiers)

                # Parse params
                params = _parse_params(params_raw)
                rets = _parse_params(returns_raw)

                # Extract function body for call analysis
                fn_body_start = source_clean.find("{", fn_match.end() - 1)
                fn_body = ""
                if fn_body_start != -1:
                    fn_body = _extract_body(source_clean, fn_body_start)

                # Reads/writes (heuristic: any state var name appearing in body)
                reads = [sv.name for sv in state_vars if sv.name in fn_body]
                writes = [
                    sv.name for sv in state_vars
                    if re.search(rf"\b{re.escape(sv.name)}\s*[=\[]", fn_body)
                ]

                # External calls
                external_calls = [
                    f"{ec.group(1)}.{ec.group(2)}"
                    for ec in _EXTERNAL_CALL_RE.finditer(fn_body)
                    if ec.group(1)[0].isupper()  # heuristic: contract names are capitalised
                ]

                functions.append(FunctionFlow(
                    name=fn_name,
                    contract=name,
                    visibility=visibility,
                    mutability=mutability,
                    modifiers=modifiers,
                    reads=reads,
                    writes=writes,
                    internal_calls=[],
                    external_calls=external_calls,
                    parameters=params,
                    returns=rets,
                ))

            # Events
            events = _EVENT_RE.findall(body)

            contracts.append(Contract(
                name=name,
                file_path=str(fpath),
                is_interface=(kind == "interface"),
                is_abstract=("abstract" in kind),
                is_library=(kind == "library"),
                inherits=inherits,
                state_variables=state_vars,
                functions=functions,
                modifiers=list({mod for fn in functions for mod in fn.modifiers}),
                events=events,
            ))

    return contracts


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_solidity_files(repo: Path) -> list[Path]:
    """Find all .sol files, prioritising src/ and contracts/ directories."""
    sol_files = []
    for search_dir in ["src", "contracts", "."]:
        d = repo / search_dir
        if d.exists():
            found = list(d.rglob("*.sol"))
            # Exclude test and script directories
            found = [
                f for f in found
                if "/test/" not in str(f) and "/script/" not in str(f)
                and "/node_modules/" not in str(f) and "/lib/" not in str(f)
            ]
            sol_files.extend(found)
    # Deduplicate
    return list(dict.fromkeys(sol_files))


def _strip_comments(source: str) -> str:
    """Remove single-line and multi-line comments."""
    # Multi-line
    source = re.sub(r"/\*.*?\*/", "", source, flags=re.DOTALL)
    # Single-line
    source = re.sub(r"//.*$", "", source, flags=re.MULTILINE)
    return source


def _extract_body(source: str, brace_pos: int) -> str:
    """Extract the body enclosed in braces starting at brace_pos."""
    if brace_pos >= len(source) or source[brace_pos] != "{":
        return ""
    depth = 0
    start = brace_pos
    for i in range(brace_pos, len(source)):
        if source[i] == "{":
            depth += 1
        elif source[i] == "}":
            depth -= 1
            if depth == 0:
                return source[start + 1 : i]
    return source[start + 1 :]


def _parse_params(raw: str) -> list[dict]:
    """Parse a comma-separated Solidity parameter list."""
    if not raw.strip():
        return []
    params = []
    for part in raw.split(","):
        tokens = part.strip().split()
        if len(tokens) >= 2:
            params.append({"type": tokens[0], "name": tokens[-1]})
        elif len(tokens) == 1:
            params.append({"type": tokens[0], "name": ""})
    return params
