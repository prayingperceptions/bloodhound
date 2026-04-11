#!/usr/bin/env python3
"""
bloodhound.py — CLI entrypoint & Listening Mode.

Commands:
  bloodhound hunt <repo_url> [--mode code4rena|immunefi]
  bloodhound map <repo_path>
  bloodhound reason <state_map_path>
  bloodhound fuzz <repo_path> <hypothesis_file>
  bloodhound report <findings_path> --mode <mode>
  bloodhound listen
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import click
import yaml
from rich.console import Console
from rich.panel import Panel

# Ensure project root is on sys.path
sys.path.insert(0, str(Path(__file__).parent))

from core.state_map import StateMap, ExploitHypothesis
from core import mythos_loop
from skills import bloodhound_mapper, bloodhound_reasoner, bloodhound_fuzz, bloodhound_report

console = Console()

# ---------------------------------------------------------------------------
# Config loader
# ---------------------------------------------------------------------------

def load_config(config_path: str | Path | None = None) -> dict:
    """Load configuration from config.yaml."""
    if config_path and Path(config_path).exists():
        with open(config_path) as f:
            return yaml.safe_load(f) or {}

    # Default locations
    for candidate in ["config.yaml", Path(__file__).parent / "config.yaml"]:
        if Path(candidate).exists():
            with open(candidate) as f:
                return yaml.safe_load(f) or {}

    return {}


def _resolve_config(config: dict) -> dict:
    """Resolve environment variable references in config values."""
    resolved = {}
    for key, value in config.items():
        if isinstance(value, dict):
            resolved[key] = _resolve_config(value)
        elif isinstance(value, str) and value.startswith("${") and value.endswith("}"):
            env_var = value[2:-1]
            resolved[key] = os.environ.get(env_var, "")
        else:
            resolved[key] = value
    return resolved


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.group()
@click.option("--config", "-c", "config_path", default=None, help="Path to config.yaml")
@click.pass_context
def cli(ctx, config_path):
    """🐺 Bloodhound — Mythos-class autonomous security agent."""
    ctx.ensure_object(dict)
    ctx.obj["config"] = _resolve_config(load_config(config_path))


@cli.command()
@click.argument("repo_url")
@click.option("--mode", "-m", default="code4rena", type=click.Choice(["code4rena", "immunefi"]))
@click.option("--output", "-o", default="output", help="Output directory")
@click.option("--skip-fuzz", is_flag=True, help="Skip Foundry fuzzing step")
@click.pass_context
def hunt(ctx, repo_url: str, mode: str, output: str, skip_fuzz: bool):
    """Run the full Mythos hunting loop on a target repository."""
    config = ctx.obj["config"]

    # If it's a URL, clone it
    if repo_url.startswith("http") or repo_url.startswith("git@"):
        repo_path = _clone_repo(repo_url, output)
    else:
        repo_path = Path(repo_url).resolve()

    if not repo_path.exists():
        console.print(f"[bold red]Repository not found: {repo_path}[/bold red]")
        raise SystemExit(1)

    state_map = mythos_loop.execute(
        repo_path=repo_path,
        config=config,
        report_mode=mode,
        output_dir=output,
        skip_fuzz=skip_fuzz,
    )

    console.print(f"\n[bold green]Hunt complete.[/bold green] Findings: {len(state_map.findings)}")


@cli.command()
@click.argument("repo_path")
@click.option("--output", "-o", default="output", help="Output directory")
@click.pass_context
def map(ctx, repo_path: str, output: str):
    """Run the mapper only — generate state_map.json and protocol diagram."""
    state_map = bloodhound_mapper.run(
        repo_path=repo_path,
        output_dir=output,
    )
    console.print(f"\n[green]✓[/green] Mapped {len(state_map.contracts)} contracts")


@cli.command()
@click.argument("state_map_path")
@click.pass_context
def reason(ctx, state_map_path: str):
    """Run the reasoner on an existing state_map.json."""
    config = ctx.obj["config"]
    state_map = StateMap.from_json(state_map_path)

    hypotheses = bloodhound_reasoner.run(
        state_map=state_map,
        config=config,
    )

    # Save hypotheses
    state_map.hypotheses = hypotheses
    out_path = Path(state_map_path).parent / "state_map_with_hypotheses.json"
    state_map.to_json(out_path)
    console.print(f"\n[green]✓[/green] Generated {len(hypotheses)} hypotheses → {out_path}")


@cli.command()
@click.argument("repo_path")
@click.argument("hypothesis_file")
@click.pass_context
def fuzz(ctx, repo_path: str, hypothesis_file: str):
    """Run the fuzzer on a specific hypothesis file."""
    config = ctx.obj["config"]

    # Load hypothesis
    with open(hypothesis_file) as f:
        hyp_data = json.load(f)

    hypothesis = ExploitHypothesis(**hyp_data)
    state_map_path = Path(hypothesis_file).parent / "state_map.json"

    if state_map_path.exists():
        state_map = StateMap.from_json(state_map_path)
    else:
        state_map = StateMap(protocol_name="unknown", repo_path=repo_path)

    result = bloodhound_fuzz.run(
        hypothesis=hypothesis,
        state_map=state_map,
        repo_path=repo_path,
        config=config,
    )

    status = "[red]VIOLATED[/red]" if not result.passed else "[green]HELD[/green]"
    console.print(f"\n  Invariant: {status}")


@cli.command()
@click.argument("findings_path")
@click.option("--mode", "-m", default="code4rena", type=click.Choice(["code4rena", "immunefi"]))
@click.option("--output", "-o", default="output/reports", help="Output directory")
@click.pass_context
def report(ctx, findings_path: str, mode: str, output: str):
    """Generate reports from a state_map with findings."""
    state_map = StateMap.from_json(findings_path)

    paths = bloodhound_report.run(
        state_map=state_map,
        mode=mode,
        output_dir=output,
    )

    console.print(f"\n[green]✓[/green] Generated {len(paths)} reports in {output}")


@cli.command()
@click.option("--mode", "-m", default="code4rena", type=click.Choice(["code4rena", "immunefi"]))
@click.option("--output", "-o", default="output", help="Output directory")
@click.option("--skip-fuzz", is_flag=True, help="Skip Foundry fuzzing step")
@click.pass_context
def listen(ctx, mode: str, output: str, skip_fuzz: bool):
    """Enter Listening Mode — wait for repository URLs on stdin."""
    config = ctx.obj["config"]

    console.print(Panel(
        "[bold white]🐺 BLOODHOUND — LISTENING MODE[/bold white]\n\n"
        "  Paste a repository URL and press Enter to begin a hunt.\n"
        "  Type [cyan]quit[/cyan] or [cyan]exit[/cyan] to stop.\n\n"
        f"  Report mode: [yellow]{mode}[/yellow]\n"
        f"  Fuzz: [{'green' if not skip_fuzz else 'red'}]{'enabled' if not skip_fuzz else 'disabled'}[/]",
        border_style="red",
        padding=(1, 2),
    ))

    while True:
        try:
            console.print("\n[bold cyan]bloodhound>[/bold cyan] ", end="")
            user_input = input().strip()

            if not user_input:
                continue
            if user_input.lower() in ("quit", "exit", "q"):
                console.print("[dim]Shutting down.[/dim]")
                break

            # Treat input as a repo URL or path
            if user_input.startswith("http") or user_input.startswith("git@"):
                repo_path = _clone_repo(user_input, output)
            else:
                repo_path = Path(user_input).resolve()

            if not repo_path.exists():
                console.print(f"[red]Not found: {repo_path}[/red]")
                continue

            # Run the full Mythos loop
            state_map = mythos_loop.execute(
                repo_path=repo_path,
                config=config,
                report_mode=mode,
                output_dir=output,
                skip_fuzz=skip_fuzz,
            )

            console.print(
                f"\n[green]Hunt complete.[/green] "
                f"Findings: {len(state_map.findings)}"
            )

        except KeyboardInterrupt:
            console.print("\n[dim]Interrupted. Type 'quit' to exit.[/dim]")
        except Exception as e:
            console.print(f"[bold red]Error:[/bold red] {e}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _clone_repo(url: str, output_dir: str) -> Path:
    """Clone a git repository to the output directory."""
    out = Path(output_dir) / "repos"
    out.mkdir(parents=True, exist_ok=True)

    # Security Audit (Phase 3): Sanitize repo name to prevent path traversal
    repo_name = url.rstrip("/").split("/")[-1].replace(".git", "")
    repo_name = "".join(c for c in repo_name if c.isalnum() or c in ("-", "_"))
    target = out / repo_name

    if target.exists():
        console.print(f"  [dim]Repo already cloned: {target}[/dim]")
        # Pull latest
        try:
            subprocess.run(
                ["git", "pull"],
                cwd=str(target),
                capture_output=True, timeout=60,
            )
        except Exception:
            pass
        return target

    # Security Audit (Phase 3): Sanitize URL and use -- to prevent flag injection
    if url.startswith("-"):
        raise ValueError(f"Malicious repository URL detected: {url}")

    console.print(f"  Cloning [cyan]{url}[/cyan]...")
    try:
        result = subprocess.run(
            ["git", "clone", "--depth", "1", "--", url, str(target)],
            capture_output=True, text=True, timeout=120,
        )
        if result.returncode != 0:
            console.print(f"[red]Clone failed: {result.stderr}[/red]")
            raise SystemExit(1)
    except subprocess.TimeoutExpired:
        console.print("[red]Clone timed out.[/red]")
        raise SystemExit(1)

    console.print(f"  [green]✓[/green] Cloned to {target}")
    return target


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    cli()
