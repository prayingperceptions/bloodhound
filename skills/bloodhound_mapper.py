"""
skills/bloodhound_mapper.py — State-space mapper.

Scrapes a target Solidity project and generates a state_map.json
linking Contracts, Variables, and Economic Invariants.
Also produces a Protocol Relationship Diagram (Mermaid).
"""

from __future__ import annotations

from pathlib import Path

from rich.console import Console
from rich.panel import Panel

from core.solidity_parser import extract_contracts, build_call_graph
from core.heuristics import auto_generate_invariants, detect_anomalies
from core.state_map import StateMap

console = Console()


def run(
    repo_path: str | Path,
    output_dir: str | Path = "output",
    protocol_name: str | None = None,
) -> StateMap:
    """
    Map the entire state space of a Solidity project.

    1. Discover & parse all .sol files.
    2. Auto-generate economic invariants via domain heuristics.
    3. Detect anomalies.
    4. Serialize to state_map.json.
    5. Generate Protocol Relationship Diagram.

    Returns the populated StateMap.
    """
    repo = Path(repo_path).resolve()
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    if not protocol_name:
        protocol_name = repo.name

    console.print(Panel(
        f"[bold cyan]Bloodhound Mapper[/bold cyan]\n"
        f"Target: [yellow]{repo}[/yellow]\n"
        f"Protocol: [green]{protocol_name}[/green]",
        title="🔍 Phase 1 — Shadowing",
        border_style="cyan",
    ))

    # Step 1: Extract contracts
    console.print("\n[bold]Step 1:[/bold] Extracting contracts...")
    contracts = extract_contracts(repo)
    console.print(f"  → Found [green]{len(contracts)}[/green] contracts")

    for c in contracts:
        kind = "interface" if c.is_interface else ("library" if c.is_library else "contract")
        console.print(
            f"    • {c.name} ({kind}) — "
            f"{len(c.state_variables)} vars, "
            f"{len(c.functions)} functions"
        )

    # Step 2: Build the StateMap
    state_map = StateMap(
        protocol_name=protocol_name,
        repo_path=str(repo),
        contracts=contracts,
    )

    # Step 3: Auto-generate invariants
    console.print("\n[bold]Step 2:[/bold] Generating economic invariants...")
    invariants = auto_generate_invariants(state_map)
    state_map.invariants = invariants
    console.print(f"  → Generated [green]{len(invariants)}[/green] invariants")
    for inv in invariants:
        console.print(f"    • [{inv.severity_if_violated}] {inv.description}")

    # Step 4: Detect anomalies
    console.print("\n[bold]Step 3:[/bold] Detecting anomalies...")
    anomalies = detect_anomalies(state_map)
    state_map.anomalies = anomalies
    console.print(f"  → Detected [yellow]{len(anomalies)}[/yellow] anomalies")
    for anom in anomalies:
        console.print(f"    • [{anom.severity_hint}] {anom.description}")

    # Step 5: Serialize state map
    map_path = out / "state_map.json"
    state_map.to_json(map_path)
    console.print(f"\n[bold green]✓[/bold green] State map saved to [cyan]{map_path}[/cyan]")

    # Step 6: Generate Protocol Relationship Diagram
    diagram = state_map.generate_mermaid_diagram()
    diagram_path = out / "protocol_diagram.md"
    diagram_content = f"# Protocol Relationship Diagram — {protocol_name}\n\n```mermaid\n{diagram}\n```\n"
    diagram_path.write_text(diagram_content, encoding="utf-8")
    console.print(f"[bold green]✓[/bold green] Diagram saved to [cyan]{diagram_path}[/cyan]")

    # Step 7: Print call graph summary
    call_graph = build_call_graph(contracts)
    total_edges = sum(len(v) for v in call_graph.values())
    console.print(
        f"\n[bold]Call graph:[/bold] {len(call_graph)} nodes, {total_edges} edges"
    )

    console.print(Panel(
        f"Contracts: {len(contracts)}\n"
        f"Invariants: {len(invariants)}\n"
        f"Anomalies: {len(anomalies)}\n"
        f"Call graph: {len(call_graph)} nodes",
        title="📊 Mapping Complete",
        border_style="green",
    ))

    return state_map
