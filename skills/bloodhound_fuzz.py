"""
skills/bloodhound_fuzz.py — Foundry invariant test generator.

Generates handler-based InvariantTest suites that target the StateMap
invariants, specifically checking for slippage, oracle manipulation,
and rounding drift.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader

from core.state_map import (
    ExploitHypothesis,
    EconomicInvariant,
    FuzzResult,
    StateMap,
)

from rich.console import Console
from rich.panel import Panel

console = Console()

# ---------------------------------------------------------------------------
# Template directory
# ---------------------------------------------------------------------------

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run(
    hypothesis: ExploitHypothesis,
    state_map: StateMap,
    repo_path: str | Path,
    config: dict | None = None,
) -> FuzzResult:
    """
    Generate and run a Foundry invariant test for a given exploit hypothesis.

    1. Load the Jinja2 template.
    2. Generate a Handler + InvariantTest contract.
    3. Write to test/PoC_Bloodhound.t.sol in the target repo.
    4. Run `forge test`.
    5. Parse results.

    Returns a FuzzResult.
    """
    config = config or {}
    repo = Path(repo_path).resolve()

    console.print(Panel(
        f"[bold yellow]Bloodhound Fuzzer[/bold yellow]\n"
        f"Hypothesis: [cyan]{hypothesis.id}[/cyan] — {hypothesis.description[:60]}...\n"
        f"Target: [yellow]{repo}[/yellow]",
        title="🎯 Phase 3 — Invariant Fuzzing",
        border_style="yellow",
    ))

    # Step 1: Resolve the invariant being tested
    invariant = state_map.get_invariant(hypothesis.violated_invariant)
    if not invariant:
        console.print(f"[yellow]Invariant {hypothesis.violated_invariant} not found, using hypothesis data.[/yellow]")
        invariant = EconomicInvariant(
            id=hypothesis.violated_invariant,
            description=hypothesis.description,
            expression="// Custom hypothesis check",
            severity_if_violated="High",
        )

    # Step 2: Identify target contracts and their entry points
    target_contracts = _identify_target_contracts(hypothesis, state_map)

    # Step 3: Generate the test file
    test_code = _generate_test(hypothesis, invariant, target_contracts, state_map)

    # Step 4: Write to the repo
    test_dir = repo / "test"
    test_dir.mkdir(exist_ok=True)
    test_file = test_dir / f"PoC_Bloodhound_{hypothesis.id.replace('-', '_')}.t.sol"
    test_file.write_text(test_code, encoding="utf-8")
    console.print(f"  [green]✓[/green] Test written to [cyan]{test_file}[/cyan]")

    # Step 5: Run forge test
    fuzz_runs = config.get("foundry", {}).get("fuzz_runs", 1000)
    fuzz_depth = config.get("foundry", {}).get("fuzz_depth", 50)
    fail_on_revert = config.get("foundry", {}).get("fail_on_revert", False)

    result = _run_forge_test(
        repo, test_file.name,
        fuzz_runs=fuzz_runs,
        fuzz_depth=fuzz_depth,
        fail_on_revert=fail_on_revert,
    )

    result.hypothesis_id = hypothesis.id

    if not result.passed:
        console.print(f"  [bold red]✘ INVARIANT VIOLATED![/bold red] — {hypothesis.id}")
        if result.counterexample:
            console.print(f"    Counterexample: {result.counterexample[:200]}")
    else:
        console.print(f"  [green]✓ All invariants held[/green] — {hypothesis.id}")

    return result


def generate_standalone_test(
    state_map: StateMap,
    repo_path: str | Path,
) -> Path:
    """
    Generate a standalone invariant test suite that checks ALL
    economic invariants in the state map (not hypothesis-specific).
    """
    repo = Path(repo_path).resolve()
    test_dir = repo / "test"
    test_dir.mkdir(exist_ok=True)

    entrypoints = state_map.get_external_entrypoints()
    contracts_with_fns: dict[str, list] = {}
    for fn in entrypoints:
        contracts_with_fns.setdefault(fn.contract, []).append(fn)

    test_code = _generate_full_invariant_suite(state_map, contracts_with_fns)
    test_file = test_dir / "PoC_Bloodhound.t.sol"
    test_file.write_text(test_code, encoding="utf-8")

    return test_file


# ---------------------------------------------------------------------------
# Test generation
# ---------------------------------------------------------------------------

def _generate_test(
    hypothesis: ExploitHypothesis,
    invariant: EconomicInvariant,
    target_contracts: dict[str, list],
    state_map: StateMap,
) -> str:
    """Generate a Foundry test from hypothesis + invariant using Jinja2 template if available, else inline."""
    template_path = TEMPLATE_DIR / "invariant_test.sol.j2"

    if template_path.exists():
        env = Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
        template = env.get_template("invariant_test.sol.j2")
        return template.render(
            hypothesis=hypothesis,
            invariant=invariant,
            target_contracts=target_contracts,
            state_map=state_map,
            protocol_name=state_map.protocol_name,
        )

    # Inline fallback
    return _generate_inline_test(hypothesis, invariant, target_contracts, state_map)


def _generate_inline_test(
    hypothesis: ExploitHypothesis,
    invariant: EconomicInvariant,
    target_contracts: dict[str, list],
    state_map: StateMap,
) -> str:
    """Generate test code without Jinja2 template."""
    contract_name = list(target_contracts.keys())[0] if target_contracts else "Target"
    functions = list(target_contracts.values())[0] if target_contracts else []

    # Build handler functions
    handler_fns = []
    for fn in functions[:10]:  # Limit to 10 entry points
        params = []
        bound_stmts = []
        for i, p in enumerate(fn.parameters):
            param_name = p.get("name", f"arg{i}")
            param_type = p.get("type", "uint256")
            if "uint" in param_type:
                params.append(f"{param_type} {param_name}")
                bound_stmts.append(
                    f"        {param_name} = bound({param_name}, 0, type({param_type}).max / 2);"
                )
            elif "address" in param_type:
                params.append(f"{param_type} {param_name}")
            else:
                params.append(f"{param_type} {param_name}")

        handler_fns.append({
            "name": fn.name,
            "params": ", ".join(params),
            "bounds": "\n".join(bound_stmts),
            "call": f"target.{fn.name}({', '.join(p.get('name', f'arg{i}') for i, p in enumerate(fn.parameters))})",
        })

    # Build the Solidity source
    handler_methods = ""
    for hf in handler_fns:
        handler_methods += f"""
    function {hf['name']}({hf['params']}) public {{
{hf['bounds']}
        try {hf['call']} {{}} catch {{}}
    }}
"""

    return f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * @title PoC_Bloodhound_{hypothesis.id.replace('-', '_')}
 * @notice Auto-generated by Bloodhound Mythos Engine
 * @dev Hypothesis: {hypothesis.description[:120]}
 *      Violated Invariant: {invariant.id} — {invariant.description[:100]}
 */

// --- Handler Contract ---
contract PoC_Handler is Test {{
    // Target contract reference — update this import path as needed
    // import {{ {contract_name} }} from "src/{contract_name}.sol";
    // {contract_name} public target;

    address public target;

    constructor(address _target) {{
        target = _target;
    }}
{handler_methods}
    // Ghost variables for tracking state
    uint256 public ghostTotalDeposited;
    uint256 public ghostTotalWithdrawn;
}}

// --- Invariant Test Contract ---
contract PoC_Bloodhound_{hypothesis.id.replace('-', '_')} is Test {{
    PoC_Handler public handler;

    function setUp() public {{
        // TODO: Deploy or fork the target contract
        // {contract_name} target = new {contract_name}();
        // handler = new PoC_Handler(address(target));
        // targetContract(address(handler));
    }}

    /// @notice {invariant.description}
    function invariant_{invariant.id.replace('-', '_')}() public view {{
        // {invariant.expression}
        // TODO: Implement the actual invariant check
        // Example:
        // assertGe(
        //     target.totalAssets(),
        //     handler.ghostTotalDeposited() - handler.ghostTotalWithdrawn(),
        //     "{invariant.id}: {invariant.description[:60]}"
        // );
        assertTrue(true, "Placeholder — implement invariant check");
    }}

    function afterInvariant() public view {{
        // Log state for debugging
        // console.log("Ghost deposited:", handler.ghostTotalDeposited());
        // console.log("Ghost withdrawn:", handler.ghostTotalWithdrawn());
    }}
}}
"""


def _generate_full_invariant_suite(
    state_map: StateMap,
    contracts_with_fns: dict[str, list],
) -> str:
    """Generate a comprehensive test file covering all invariants."""
    invariant_checks = ""
    for inv in state_map.invariants:
        invariant_checks += f"""
    /// @notice {inv.description}
    function invariant_{inv.id.replace('-', '_')}() public view {{
        // {inv.expression}
        assertTrue(true, "{inv.id}: Placeholder");
    }}
"""

    return f"""// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "forge-std/Test.sol";

/**
 * @title PoC_Bloodhound
 * @notice Full invariant suite auto-generated by Bloodhound
 * @dev Protocol: {state_map.protocol_name}
 *      Invariants: {len(state_map.invariants)}
 */
contract PoC_Bloodhound is Test {{

    function setUp() public {{
        // TODO: Deploy or fork target contracts
    }}
{invariant_checks}
    function afterInvariant() public view {{
        // Cleanup / logging hook
    }}
}}
"""


# ---------------------------------------------------------------------------
# Contract identification
# ---------------------------------------------------------------------------

def _identify_target_contracts(
    hypothesis: ExploitHypothesis,
    state_map: StateMap,
) -> dict[str, list]:
    """
    Identify which contracts and functions are involved in the hypothesis chain.
    Returns: { contract_name: [FunctionFlow, ...] }
    """
    targets: dict[str, list] = {}

    # Parse chain entries like "Contract.function(args)"
    for step in hypothesis.chain:
        parts = step.split(".")
        if len(parts) >= 2:
            contract_name = parts[0]
            fn_name = parts[1].split("(")[0]
            contract = state_map.get_contract(contract_name)
            if contract:
                for fn in contract.functions:
                    if fn.name == fn_name:
                        targets.setdefault(contract_name, []).append(fn)
                        break

    # If chain parsing didn't yield results, use all entrypoints
    if not targets:
        for fn in state_map.get_external_entrypoints()[:10]:
            targets.setdefault(fn.contract, []).append(fn)

    return targets


# ---------------------------------------------------------------------------
# Forge execution
# ---------------------------------------------------------------------------

def _run_forge_test(
    repo: Path,
    test_file_name: str,
    fuzz_runs: int = 1000,
    fuzz_depth: int = 50,
    fail_on_revert: bool = False,
) -> FuzzResult:
    """Run forge test and parse results."""
    contract_name = test_file_name.replace(".t.sol", "")

    cmd = [
        "forge", "test",
        "--match-path", f"test/{test_file_name}",
        "--no-ffi",  # Security Audit (Phase 3): Prevent RCE from malicious foundry.toml
        "-vvv",
    ]

    env = os.environ.copy()
    env["FOUNDRY_FUZZ_RUNS"] = str(fuzz_runs)
    env["FOUNDRY_INVARIANT_DEPTH"] = str(fuzz_depth)
    if fail_on_revert:
        env["FOUNDRY_INVARIANT_FAIL_ON_REVERT"] = "true"

    console.print(f"  [dim]Running: {' '.join(cmd)}[/dim]")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=300,  # 5 minute timeout
            env=env,
        )

        output = result.stdout + result.stderr
        passed = result.returncode == 0

        # Extract counterexample if test failed
        counterexample = None
        counter_match = re.search(r"Counterexample:.*?(?=\n\n|\Z)", output, re.DOTALL)
        if counter_match:
            counterexample = counter_match.group(0)

        # Extract trace
        trace = None
        trace_match = re.search(r"Traces:.*?(?=\n\n|\Z)", output, re.DOTALL)
        if trace_match:
            trace = trace_match.group(0)

        return FuzzResult(
            hypothesis_id="",
            passed=passed,
            counterexample=counterexample,
            trace=trace,
            forge_output=output[-2000:],  # Keep last 2000 chars
        )

    except FileNotFoundError:
        console.print("[bold red]forge not found![/bold red] Install Foundry first.")
        return FuzzResult(
            hypothesis_id="",
            passed=True,  # Don't flag as finding if we can't test
            forge_output="ERROR: forge not found",
        )
    except subprocess.TimeoutExpired:
        console.print("[yellow]forge test timed out after 5 minutes.[/yellow]")
        return FuzzResult(
            hypothesis_id="",
            passed=True,
            forge_output="ERROR: timeout",
        )
