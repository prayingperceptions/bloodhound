"""
core/mythos_loop.py — The Mythos reasoning loop orchestrator.

Implements the 4-step autonomous security analysis:
  1. Shadow  — Map function call flows
  2. Detect  — Identify anomalies via heuristics
  3. Chain   — LLM-powered exploit chain reasoning
  4. Verify  — Foundry invariant testing

This is the brain of Bloodhound.
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

from core.state_map import (
    ExploitHypothesis,
    Finding,
    FuzzResult,
    StateMap,
)
from skills import bloodhound_mapper
from skills import bloodhound_reasoner
from skills import bloodhound_fuzz
from skills import bloodhound_report

console = Console()


def execute(
    repo_path: str | Path,
    config: dict | None = None,
    report_mode: str = "code4rena",
    output_dir: str | Path = "output",
    skip_fuzz: bool = False,
) -> StateMap:
    """
    Execute the full Mythos reasoning loop.

    Args:
        repo_path: Path to the target Solidity project.
        config: Configuration dict (LLM, Foundry settings).
        report_mode: "code4rena" or "immunefi".
        output_dir: Where to write outputs.
        skip_fuzz: If True, skip the Foundry fuzzing step.

    Returns:
        The fully populated StateMap with findings.
    """
    config = config or {}
    repo = Path(repo_path).resolve()
    out = Path(output_dir)

    console.print(Panel(
        "[bold white on red] BLOODHOUND — MYTHOS ENGINE [/bold white on red]\n\n"
        f"  Target:  [cyan]{repo}[/cyan]\n"
        f"  Mode:    [yellow]{report_mode}[/yellow]\n"
        f"  Output:  [green]{out}[/green]\n"
        f"  Fuzz:    [{'green' if not skip_fuzz else 'red'}]{'enabled' if not skip_fuzz else 'disabled'}[/{'green' if not skip_fuzz else 'red'}]",
        title="🐺 Mythos Reasoning Loop",
        border_style="red",
        padding=(1, 2),
    ))

    # -----------------------------------------------------------------------
    # Step 1: SHADOW — Map the protocol state space
    # -----------------------------------------------------------------------
    console.rule("[bold cyan]Step 1 — Shadowing[/bold cyan]")
    state_map = bloodhound_mapper.run(
        repo_path=repo,
        output_dir=out,
        protocol_name=repo.name,
    )

    if not state_map.contracts:
        console.print("[bold red]No contracts found. Aborting.[/bold red]")
        return state_map

    # -----------------------------------------------------------------------
    # Step 2: DETECT — Anomaly detection is already done by the mapper
    #                   (heuristics.detect_anomalies was called in mapper.run)
    # -----------------------------------------------------------------------
    console.rule("[bold yellow]Step 2 — Anomaly Detection[/bold yellow]")
    console.print(
        f"  Anomalies from mapping phase: [yellow]{len(state_map.anomalies)}[/yellow]"
    )

    if not state_map.anomalies:
        console.print("[green]No anomalies detected. Protocol looks clean.[/green]")
        _finalize(state_map, report_mode, out)
        return state_map

    # -----------------------------------------------------------------------
    # Step 3: CHAIN — Mythos-style exploit reasoning
    # -----------------------------------------------------------------------
    console.rule("[bold magenta]Step 3 — Chain-Exploit Reasoning[/bold magenta]")
    hypotheses = bloodhound_reasoner.run(
        state_map=state_map,
        config=config,
    )
    state_map.hypotheses = hypotheses

    if not hypotheses:
        console.print("[green]No exploitable chains identified.[/green]")
        _finalize(state_map, report_mode, out)
        return state_map

    console.print(f"  Hypotheses to verify: [magenta]{len(hypotheses)}[/magenta]")

    # -----------------------------------------------------------------------
    # Step 4: VERIFY — Foundry invariant testing
    # -----------------------------------------------------------------------
    console.rule("[bold red]Step 4 — Verification[/bold red]")

    if skip_fuzz:
        console.print("[yellow]Fuzzing skipped. Converting hypotheses to unverified findings.[/yellow]")
        for hyp in hypotheses:
            state_map.findings.append(_hypothesis_to_finding(hyp, state_map, verified=False))
    else:
        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            for hyp in hypotheses:
                task = progress.add_task(
                    f"Fuzzing {hyp.id}...", total=None
                )
                try:
                    result = bloodhound_fuzz.run(
                        hypothesis=hyp,
                        state_map=state_map,
                        repo_path=repo,
                        config=config,
                    )

                    if not result.passed:
                        # Invariant violated — confirmed finding!
                        finding = _hypothesis_to_finding(
                            hyp, state_map,
                            verified=True,
                            fuzz_result=result,
                        )
                        state_map.findings.append(finding)
                        progress.update(task, description=f"[red]✘ {hyp.id} — VIOLATED[/red]")
                    else:
                        progress.update(task, description=f"[green]✓ {hyp.id} — held[/green]")

                except Exception as e:
                    console.print(f"[yellow]Fuzz error for {hyp.id}: {e}[/yellow]")
                    # Still record as unverified finding
                    state_map.findings.append(
                        _hypothesis_to_finding(hyp, state_map, verified=False)
                    )

                progress.remove_task(task)

    # -----------------------------------------------------------------------
    # Finalize — Generate reports
    # -----------------------------------------------------------------------
    _finalize(state_map, report_mode, out)

    # Save final state map
    state_map.to_json(out / "state_map_final.json")

    return state_map


def _finalize(state_map: StateMap, mode: str, out: Path):
    """Generate reports and print summary."""
    console.rule("[bold blue]Report Generation[/bold blue]")

    if state_map.findings:
        report_paths = bloodhound_report.run(
            state_map=state_map,
            mode=mode,
            output_dir=out / "reports",
        )
    else:
        console.print("[green]No findings to report.[/green]")
        report_paths = []

    # Final summary
    console.print(Panel(
        f"  Contracts analyzed:  {len(state_map.contracts)}\n"
        f"  Invariants checked:  {len(state_map.invariants)}\n"
        f"  Anomalies detected:  {len(state_map.anomalies)}\n"
        f"  Hypotheses tested:   {len(state_map.hypotheses)}\n"
        f"  Confirmed findings:  {len([f for f in state_map.findings if 'unverified' not in f.title.lower()])}\n"
        f"  Reports generated:   {len(report_paths)}",
        title="🐺 Bloodhound — Hunt Complete",
        border_style="green",
        padding=(1, 2),
    ))


def _hypothesis_to_finding(
    hyp: ExploitHypothesis,
    state_map: StateMap,
    verified: bool = False,
    fuzz_result: FuzzResult | None = None,
) -> Finding:
    """Convert a hypothesis to a Finding."""
    invariant = state_map.get_invariant(hyp.violated_invariant)
    severity = invariant.severity_if_violated if invariant else "Medium"

    # Determine the contract and function from the chain
    contract = "Unknown"
    function = "Unknown"
    if hyp.chain:
        parts = hyp.chain[0].split(".")
        if len(parts) >= 2:
            contract = parts[0]
            function = parts[1].split("(")[0]

    title_prefix = "" if verified else "[Unverified] "

    return Finding(
        id=hyp.id.replace("HYPO", "FIND"),
        title=f"{title_prefix}{hyp.description[:100]}",
        severity=severity,
        description=hyp.description,
        impact=hyp.economic_impact,
        proof_of_concept=fuzz_result.counterexample or "// PoC pending manual verification"
            if fuzz_result else "// Requires manual PoC",
        recommendation=(
            f"Review the interaction between: {', '.join(hyp.chain[:3])}. "
            f"{'The invariant ' + hyp.violated_invariant + ' was violated during fuzz testing.' if verified else 'Manual verification recommended.'}"
        ),
        contract=contract,
        function=function,
        category=invariant.category if invariant else "general",
        forge_output=fuzz_result.forge_output if fuzz_result else "",
        hypothesis=hyp,
    )
