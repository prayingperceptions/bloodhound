"""
skills/bloodhound_report.py — Dual-mode report formatter.

Generates high-impact security reports compatible with:
  - Code4rena (High/Med individual + QA consolidated)
  - Immunefi (Impact-driven, Severity-classified)
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from jinja2 import Environment, FileSystemLoader

from core.state_map import Finding, StateMap

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

console = Console()

TEMPLATE_DIR = Path(__file__).parent.parent / "templates"


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run(
    state_map: StateMap,
    mode: str = "code4rena",
    output_dir: str | Path = "output/reports",
) -> list[Path]:
    """
    Generate reports for all confirmed findings.

    Args:
        state_map: StateMap with populated findings.
        mode: "code4rena" or "immunefi".
        output_dir: Where to write reports.

    Returns:
        List of paths to generated report files.
    """
    findings = state_map.findings
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)

    console.print(Panel(
        f"[bold blue]Bloodhound Reporter[/bold blue]\n"
        f"Mode: [cyan]{mode}[/cyan]\n"
        f"Findings: [yellow]{len(findings)}[/yellow]",
        title="📝 Phase 4 — Report Generation",
        border_style="blue",
    ))

    if not findings:
        console.print("[yellow]No confirmed findings to report.[/yellow]")
        return []

    # Print summary table
    _print_summary_table(findings)

    if mode == "code4rena":
        return _generate_code4rena_reports(findings, out, state_map)
    elif mode == "immunefi":
        return _generate_immunefi_reports(findings, out, state_map)
    else:
        console.print(f"[red]Unknown mode: {mode}. Defaulting to code4rena.[/red]")
        return _generate_code4rena_reports(findings, out, state_map)


# ---------------------------------------------------------------------------
# Code4rena report generation
# ---------------------------------------------------------------------------

def _generate_code4rena_reports(
    findings: list[Finding],
    out: Path,
    state_map: StateMap,
) -> list[Path]:
    """Generate Code4rena formatted reports."""
    generated: list[Path] = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    # Separate High/Medium from QA/Low
    high_med = [f for f in findings if f.severity in ("Critical", "High", "Medium")]
    low_qa = [f for f in findings if f.severity in ("Low", "QA")]
    gas = [f for f in findings if f.severity == "Gas"]

    env = _get_template_env()

    # Individual High/Medium reports
    for finding in high_med:
        content = _render_c4_high(finding, state_map, env)
        filename = f"{timestamp}_{finding.severity}_{finding.id}.md"
        path = out / filename
        path.write_text(content, encoding="utf-8")
        generated.append(path)
        console.print(f"  [green]✓[/green] {finding.severity}: {path.name}")

    # Consolidated QA report
    if low_qa:
        content = _render_c4_qa(low_qa, state_map, env)
        filename = f"{timestamp}_QA_Report.md"
        path = out / filename
        path.write_text(content, encoding="utf-8")
        generated.append(path)
        console.print(f"  [green]✓[/green] QA Report: {path.name} ({len(low_qa)} findings)")

    # Gas optimizations
    if gas:
        content = _render_c4_gas(gas, state_map, env)
        filename = f"{timestamp}_Gas_Report.md"
        path = out / filename
        path.write_text(content, encoding="utf-8")
        generated.append(path)
        console.print(f"  [green]✓[/green] Gas Report: {path.name} ({len(gas)} findings)")

    console.print(f"\n[bold green]✓[/bold green] Generated {len(generated)} Code4rena reports")
    return generated


def _render_c4_high(finding: Finding, state_map: StateMap, env: Environment) -> str:
    """Render a single High/Medium finding for Code4rena."""
    template = env.get_template("code4rena_high.md.j2") if _template_exists("code4rena_high.md.j2") else None

    if template:
        return template.render(finding=finding, protocol=state_map.protocol_name)

    # Inline fallback
    return f"""# [{finding.severity}] {finding.title}

## Summary

{finding.description}

## Vulnerability Detail

**Contract:** `{finding.contract}`
**Function:** `{finding.function}`
**Category:** {finding.category}

{finding.description}

## Impact

{finding.impact}

## Proof of Concept

```solidity
{finding.proof_of_concept}
```

### Forge Output
```
{finding.forge_output[:1000] if finding.forge_output else "N/A"}
```

## Recommendation

{finding.recommendation}
"""


def _render_c4_qa(findings: list[Finding], state_map: StateMap, env: Environment) -> str:
    """Render consolidated QA/Low report for Code4rena."""
    template = env.get_template("code4rena_qa.md.j2") if _template_exists("code4rena_qa.md.j2") else None

    if template:
        return template.render(findings=findings, protocol=state_map.protocol_name)

    # Inline fallback
    sections = []
    for i, f in enumerate(findings, 1):
        label = f"L-{i:02d}" if f.severity == "Low" else f"QA-{i:02d}"
        sections.append(f"""## [{label}] {f.title}

**Contract:** `{f.contract}` | **Function:** `{f.function}`

{f.description}

**Impact:** {f.impact}

**Recommendation:** {f.recommendation}
""")

    return f"""# QA Report — {state_map.protocol_name}

**Findings:** {len(findings)}
**Date:** {datetime.now().strftime("%Y-%m-%d")}

---

{"---".join(sections)}
"""


def _render_c4_gas(findings: list[Finding], state_map: StateMap, env: Environment) -> str:
    """Render gas optimization report."""
    sections = []
    for i, f in enumerate(findings, 1):
        sections.append(f"""## [G-{i:02d}] {f.title}

**Contract:** `{f.contract}` | **Function:** `{f.function}`

{f.description}

**Recommendation:** {f.recommendation}
""")

    return f"""# Gas Optimization Report — {state_map.protocol_name}

**Findings:** {len(findings)}

---

{"---".join(sections)}
"""


# ---------------------------------------------------------------------------
# Immunefi report generation
# ---------------------------------------------------------------------------

def _generate_immunefi_reports(
    findings: list[Finding],
    out: Path,
    state_map: StateMap,
) -> list[Path]:
    """Generate Immunefi formatted reports."""
    generated: list[Path] = []
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    env = _get_template_env()

    for finding in findings:
        content = _render_immunefi(finding, state_map, env)
        filename = f"{timestamp}_immunefi_{finding.severity}_{finding.id}.md"
        path = out / filename
        path.write_text(content, encoding="utf-8")
        generated.append(path)

        console.print(f"  [green]✓[/green] [{finding.severity}] {path.name}")

    console.print(f"\n[bold green]✓[/bold green] Generated {len(generated)} Immunefi reports")
    return generated


def _render_immunefi(finding: Finding, state_map: StateMap, env: Environment) -> str:
    """Render an Immunefi impact-driven report."""
    template = env.get_template("immunefi_report.md.j2") if _template_exists("immunefi_report.md.j2") else None

    if template:
        return template.render(finding=finding, protocol=state_map.protocol_name)

    # Construct the attack-vector title per Immunefi standard
    attack_vector = finding.category.replace("_", " ").title()
    title = f"[{attack_vector}] in `{finding.contract}::{finding.function}` leads to {finding.impact.split('.')[0]}"

    # Inline fallback
    return f"""# {title}

## Bug Description

{finding.description}

## Vulnerability Details

**Severity:** {finding.severity}
**Contract:** `{finding.contract}`
**Function:** `{finding.function}`

### Intended Behavior
The protocol intends for the following invariant to hold:
> {finding.hypothesis.description if finding.hypothesis else "See description above."}

### Actual Behavior
The implementation deviates from the intended behavior due to:

{finding.description}

### Code Reference
Contract: `{finding.contract}`
Function: `{finding.function}`

## Impact

{finding.impact}

### Economic Collapse Path
{_generate_collapse_narrative(finding)}

## Proof of Concept

The following Foundry test demonstrates the vulnerability:

```solidity
{finding.proof_of_concept}
```

### Forge Output
```
{finding.forge_output[:1500] if finding.forge_output else "Run with: forge test --match-contract PoC_Bloodhound -vvv"}
```

## Recommendation

{finding.recommendation}
"""


def _generate_collapse_narrative(finding: Finding) -> str:
    """Generate an economic collapse path narrative for Immunefi."""
    if finding.hypothesis and finding.hypothesis.chain:
        steps = "\n".join(
            f"{i+1}. Attacker calls `{step}`"
            for i, step in enumerate(finding.hypothesis.chain)
        )
        return f"""The following sequence of operations leads to economic damage:

{steps}

This chain results in: **{finding.hypothesis.economic_impact}**
"""
    return f"The vulnerability allows: {finding.impact}"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_template_env() -> Environment:
    """Get Jinja2 template environment."""
    if TEMPLATE_DIR.exists():
        return Environment(loader=FileSystemLoader(str(TEMPLATE_DIR)))
    return Environment()


def _template_exists(name: str) -> bool:
    """Check if a template file exists."""
    return (TEMPLATE_DIR / name).exists()


def _print_summary_table(findings: list[Finding]):
    """Print a Rich table summarizing all findings."""
    table = Table(title="Findings Summary", border_style="cyan")
    table.add_column("ID", style="cyan")
    table.add_column("Severity", style="bold")
    table.add_column("Title", style="white")
    table.add_column("Contract", style="yellow")
    table.add_column("Category", style="dim")

    severity_colors = {
        "Critical": "bold red",
        "High": "red",
        "Medium": "yellow",
        "Low": "green",
        "QA": "dim",
        "Gas": "blue",
    }

    for f in findings:
        color = severity_colors.get(f.severity, "white")
        table.add_row(
            f.id,
            f"[{color}]{f.severity}[/{color}]",
            f.title[:50],
            f.contract,
            f.category,
        )

    console.print(table)
