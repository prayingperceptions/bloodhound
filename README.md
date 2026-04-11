# 🐺 Bloodhound — Mythos-class Security Agent

[![Donate Crypto](https://img.shields.io/badge/Donate-Crypto-f7931a?logo=bitcoin&logoColor=white)](https://commerce.coinbase.com/checkout/122a2979-e559-44b9-bb9d-2ff0c6a3025b)

**Autonomous, Agent-Agnostic smart contract security engine.**

Bloodhound is a standalone reasoning engine designed to be used with ANY agentic system (Antigravity, Cursor, Windsurf, Claude Code, etc.) or as a direct CLI. It treats audits as a **state-based reasoning game**, not pattern matching. 

---

## Portability & Agent Integration

Bloodhound is architected for maximum portability. Because it is a pure Python CLI with JSON/Markdown outputs, it can be easily integrated into any AI-driven workflow:

- **Cursor / Windsurf**: Add `bloodhound` to your environment and ask the agent to "Run bloodhound hunt on this repo".
- **Claude Code / OpenClaw**: Use the CLI commands via terminal to feed high-fidelity findings back into the agent's context.
- **CI/CD**: Run as a security gate in your pipeline to generate Code4rena or Immunefi-ready drafts automatically.

---

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/bloodhound
cd bloodhound

# Install as an editable package (recommended)
pip install -e .

# Set your LLM API key (pick one)
export GEMINI_API_KEY="your-key-here"
```

## Quick Start

## Architecture

```
bloodhound/
├── bloodhound.py              # CLI entrypoint & Listening Mode
├── config.yaml                # LLM, Foundry, heuristics config
│
├── core/                      # Engine internals
│   ├── state_map.py           # Central data model
│   ├── solidity_parser.py     # Slither + regex fallback parser
│   ├── heuristics.py          # Domain-specific anomaly detection
│   └── mythos_loop.py         # 4-step reasoning orchestrator
│
├── skills/                    # Atomic skills
│   ├── bloodhound_mapper.py   # State-space mapper
│   ├── bloodhound_reasoner.py # LLM chain-exploit reasoner
│   ├── bloodhound_fuzz.py     # Foundry test generator + runner
│   └── bloodhound_report.py   # Code4rena & Immunefi reporter
│
├── templates/                 # Jinja2 templates
│   ├── invariant_test.sol.j2  # Foundry InvariantTest
│   ├── code4rena_high.md.j2   # C4 High/Med finding
│   ├── code4rena_qa.md.j2     # C4 QA consolidated
│   └── immunefi_report.md.j2  # Immunefi impact-driven
│
└── output/                    # Generated artifacts
    ├── state_map.json
    ├── protocol_diagram.md
    └── reports/
```

## The Mythos Reasoning Loop

| Step | Phase | What Happens |
|------|-------|-------------|
| 1 | **Shadow** | Parse all contracts, build call graph, map state variables |
| 2 | **Detect** | Apply domain heuristics to find anomalies |
| 3 | **Chain** | LLM reasons about chaining anomalies into exploits |
| 4 | **Verify** | Generate & run Foundry invariant tests |

## CLI Commands

```bash
# Full pipeline
python bloodhound.py hunt <repo_url_or_path> --mode code4rena|immunefi

# Individual stages
python bloodhound.py map <repo_path>
python bloodhound.py reason <state_map.json>
python bloodhound.py fuzz <repo_path> <hypothesis.json>
python bloodhound.py report <state_map.json> --mode immunefi

# Interactive mode
python bloodhound.py listen
```

## Supported LLM Providers

| Provider | Env Variable | Config Key |
|----------|-------------|------------|
| Google Gemini | `GEMINI_API_KEY` | `gemini.api_key` |
| OpenAI | `OPENAI_API_KEY` | `openai.model` |
| Anthropic | `ANTHROPIC_API_KEY` | `anthropic.model` |
| Local (Ollama) | `LOCAL_MODEL_URL` | `local.base_url` |

Bloodhound auto-detects the provider from available environment variables.

## Domain Heuristics

- **Cross-Chain (OFT/LayerZero):** Tracks `amountSentLD` vs inputs, monitors daily limits for rounding drift
- **Economic Invariants:** Enforces "No Value Loss" in ERC4626 vaults, share price monotonicity
- **Agent-Payment:** Validates cryptographic binding of task signatures to payment releases

## Report Modes

### Code4rena
- High/Medium → individual reports with PoC
- Low/QA → consolidated report (`L-01`, `L-02`, ...)
- Gas → separate report

### Immunefi
- Impact-driven format: `[Attack Vector] in Contract::Function leads to Impact`
- Economic collapse path narrative
- Full runnable PoC

---

*Built for the Antigravity IDE by Project Bloodhound.*
