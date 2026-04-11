# Contributing to Bloodhound 🐺

Thank you for your interest in contributing to Bloodhound! We are building the next generation of autonomous security reasoning engines, and we welcome contributions from security researchers, auditors, and AI enthusiasts.

## Strategic Vision: The Mythos Loop
Bloodhound is more than a scanner; it is a "Mythos-class" reasoner. Contributions should focus on enhancing the **Shadow-Detect-Chain-Verify** loop:
1. **Shadow**: Improving Solidity parsing and call-graph mapping.
2. **Detect**: Adding new domain-specific heuristics (e.g., DeFi-specific invariants).
3. **Chain**: Refining the Mythos reasoning prompts for better exploit hypothesis generation.
4. **Verify**: Enhancing Foundry invariant test generation.

## How to Contribute

### 🛡️ Reporting Vulnerabilities
If you find a security vulnerability in Bloodhound itself (e.g., in our parser or executor), please do **not** open a public issue. Instead, report it privately to our team so we can address it before disclosure.

### 🐛 Bug Reports & Feature Requests
If you encounter a bug or have a suggestion, please open a GitHub Issue using the appropriate template.

### 🛠️ Pull Request Process
1. **Fork the repo** and create your branch from `main`.
2. **Ensure tests pass**: Run `pytest` and ensure no regressions.
3. **Draft your PR**: Provide a clear description of the change and the reasoning behind it.
4. **Code Quality**: Follow standard Python conventions (PEP 8) and ensure your code is well-documented.

## Development Setup

```bash
# Clone and install dev dependencies
git clone https://github.com/prayingperceptions/bloodhound
pip install -e ".[dev]"
```

## Community & Philosophy
Bloodhound is built on the philosophy of **Transparency** and **Logic-First Security**. We believe the best security tools should be open, portable, and accessible to everyone throughout the development lifecycle.

---
*Stay hungry. Stay sharp.* 🐺
