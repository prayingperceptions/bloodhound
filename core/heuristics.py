"""
core/heuristics.py — Domain-specific heuristic rules.

Focuses on three domains:
  1. Cross-Chain (OFT / LayerZero) — amountSentLD tracking, daily limit rounding
  2. Economic Invariants — ERC4626 vault math, yield aggregation
  3. Agent-Payment — cryptographic binding of task signatures to payment releases
"""

from __future__ import annotations

import re
from typing import Optional

from core.state_map import (
    Anomaly,
    Contract,
    EconomicInvariant,
    FunctionFlow,
    StateMap,
)


# ---------------------------------------------------------------------------
# Configuration (overridable via config.yaml)
# ---------------------------------------------------------------------------

VAULT_FUNCTIONS = {
    "totalAssets", "deposit", "withdraw", "redeem",
    "convertToShares", "convertToAssets", "mint",
    "previewDeposit", "previewRedeem", "previewMint", "previewWithdraw",
}

CROSS_CHAIN_FIELDS = {"amountSentLD", "amountReceivedLD", "minAmountLD", "amountLD"}

SIGNATURE_FUNCTIONS = {"ecrecover", "ECDSA.recover", "SignatureChecker.isValidSignatureNow"}

PAYMENT_FUNCTIONS = {
    "releasePayment", "claimReward", "executeTask",
    "disburse", "payout", "settle", "distribute",
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def auto_generate_invariants(state_map: StateMap) -> list[EconomicInvariant]:
    """
    Scan all contracts and auto-generate economic invariants
    based on domain heuristics.
    """
    invariants: list[EconomicInvariant] = []
    inv_counter = 0

    for contract in state_map.contracts:
        if contract.is_interface or contract.is_library:
            continue

        fn_names = {fn.name for fn in contract.functions}

        # ---- Vault / ERC4626 invariants ----
        vault_overlap = fn_names & VAULT_FUNCTIONS
        if len(vault_overlap) >= 3:  # looks like a vault
            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] Total assets must equal sum of all depositor shares * share price",
                expression=f"{contract.name}.totalAssets() >= sum_of_user_balances",
                severity_if_violated="Critical",
                related_variables=_find_vars(contract, ["totalAssets", "totalSupply", "balanceOf"]),
                related_functions=list(vault_overlap),
                category="economic",
                auto_generated=True,
            ))

            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] No value loss: deposit(x) followed by withdraw should return >= x (minus fees)",
                expression=f"withdraw(deposit(x)) >= x - maxFee",
                severity_if_violated="High",
                related_variables=_find_vars(contract, ["totalAssets", "totalSupply"]),
                related_functions=["deposit", "withdraw", "redeem"],
                category="economic",
                auto_generated=True,
            ))

            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] Share price must be monotonically non-decreasing (absent loss events)",
                expression=f"convertToAssets(1e18) >= previous_share_price",
                severity_if_violated="High",
                related_variables=_find_vars(contract, ["convertToAssets", "convertToShares"]),
                related_functions=["convertToAssets", "convertToShares"],
                category="economic",
                auto_generated=True,
            ))

        # ---- Cross-chain invariants ----
        all_var_names = {sv.name for sv in contract.state_variables}
        cross_chain_overlap = all_var_names & CROSS_CHAIN_FIELDS
        if cross_chain_overlap or _has_lz_patterns(contract):
            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] Cross-chain: amountSentLD must equal input amount after dust removal",
                expression="amountSentLD == _removeDust(amountLD)",
                severity_if_violated="High",
                related_variables=list(cross_chain_overlap),
                related_functions=_find_lz_functions(contract),
                category="cross_chain",
                auto_generated=True,
            ))

            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] Cross-chain: daily limit enforcement must not be bypassable via rounding",
                expression="dailyUsed + amountSentLD <= dailyLimit",
                severity_if_violated="Medium",
                related_variables=["dailyUsed", "dailyLimit"] + list(cross_chain_overlap),
                related_functions=_find_lz_functions(contract),
                category="cross_chain",
                auto_generated=True,
            ))

        # ---- Agent-payment invariants ----
        if _has_payment_pattern(contract):
            inv_counter += 1
            invariants.append(EconomicInvariant(
                id=f"INV-{inv_counter:03d}",
                description=f"[{contract.name}] Agent payment: task signature must be cryptographically bound to payment release",
                expression="ecrecover(taskHash, sig) == authorizedAgent",
                severity_if_violated="Critical",
                related_variables=_find_vars(contract, ["taskHash", "signature", "agent", "nonce"]),
                related_functions=_find_payment_functions(contract),
                category="agent_payment",
                auto_generated=True,
            ))

    return invariants


def detect_anomalies(state_map: StateMap) -> list[Anomaly]:
    """
    Detect deviations from standard industry patterns.
    
    Returns a list of Anomaly objects for the reasoner to chain.
    """
    anomalies: list[Anomaly] = []
    anom_counter = 0

    for contract in state_map.contracts:
        if contract.is_interface or contract.is_library:
            continue

        # 1. Missing reentrancy guards on state-changing external functions
        for fn in contract.functions:
            if (fn.visibility in ("public", "external")
                    and fn.mutability not in ("pure", "view")
                    and fn.writes
                    and fn.external_calls
                    and "nonReentrant" not in fn.modifiers
                    and "ReentrancyGuard" not in fn.modifiers):
                anom_counter += 1
                anomalies.append(Anomaly(
                    id=f"ANOM-{anom_counter:03d}",
                    description=f"State-changing function {contract.name}::{fn.name} with external calls lacks reentrancy guard",
                    location=f"{contract.name}::{fn.name}",
                    anomaly_type="missing_reentrancy_guard",
                    severity_hint="High",
                    related_invariants=[],
                    details={
                        "writes": fn.writes,
                        "external_calls": fn.external_calls,
                    },
                ))

        # 2. Unchecked return values on external calls
        for fn in contract.functions:
            if fn.external_calls:
                for ext in fn.external_calls:
                    if any(t in ext.lower() for t in ["transfer", "send", "call"]):
                        anom_counter += 1
                        anomalies.append(Anomaly(
                            id=f"ANOM-{anom_counter:03d}",
                            description=f"Potentially unchecked return value on {ext} in {contract.name}::{fn.name}",
                            location=f"{contract.name}::{fn.name}",
                            anomaly_type="unchecked_return",
                            severity_hint="Medium",
                        ))

        # 3. Custom OFT adapter pattern (non-standard LayerZero implementation)
        if _has_lz_patterns(contract):
            standard_oft_fns = {"_debit", "_credit", "send", "_lzReceive"}
            implemented = {fn.name for fn in contract.functions}
            custom_fns = implemented - standard_oft_fns - VAULT_FUNCTIONS - {"constructor"}
            if custom_fns:
                anom_counter += 1
                anomalies.append(Anomaly(
                    id=f"ANOM-{anom_counter:03d}",
                    description=f"Custom OFT adapter in {contract.name} with non-standard functions: {custom_fns}",
                    location=f"{contract.name}",
                    anomaly_type="custom_implementation",
                    severity_hint="Medium",
                    details={"custom_functions": list(custom_fns)},
                ))

        # 4. Privileged functions without access control
        for fn in contract.functions:
            sensitive_keywords = ["set", "update", "pause", "unpause", "withdraw", "migrate", "upgrade"]
            if (fn.visibility in ("public", "external")
                    and any(kw in fn.name.lower() for kw in sensitive_keywords)
                    and not fn.modifiers):
                anom_counter += 1
                anomalies.append(Anomaly(
                    id=f"ANOM-{anom_counter:03d}",
                    description=f"Privileged function {contract.name}::{fn.name} has no access control modifiers",
                    location=f"{contract.name}::{fn.name}",
                    anomaly_type="missing_access_control",
                    severity_hint="High",
                ))

        # 5. Rounding in division before multiplication
        # (This is detected via reasoner prompt, but we flag math-heavy functions)
        for fn in contract.functions:
            if any(v in fn.name.lower() for v in ["convert", "calc", "compute", "price", "rate", "share"]):
                anom_counter += 1
                anomalies.append(Anomaly(
                    id=f"ANOM-{anom_counter:03d}",
                    description=f"Math-intensive function {contract.name}::{fn.name} — check for rounding order issues",
                    location=f"{contract.name}::{fn.name}",
                    anomaly_type="rounding_risk",
                    severity_hint="Medium",
                    related_invariants=[
                        inv.id for inv in state_map.invariants
                        if fn.name in inv.related_functions
                    ],
                ))

    return anomalies


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _find_vars(contract: Contract, keywords: list[str]) -> list[str]:
    """Find state variable names matching any keyword."""
    return [
        sv.name for sv in contract.state_variables
        if any(kw.lower() in sv.name.lower() for kw in keywords)
    ]


def _has_lz_patterns(contract: Contract) -> bool:
    """Check if contract looks like a LayerZero OFT/OApp."""
    lz_markers = {"_lzReceive", "_debit", "_credit", "send", "OFT", "OApp", "Endpoint"}
    fn_names = {fn.name for fn in contract.functions}
    inherit_names = set(contract.inherits)
    return bool((fn_names | inherit_names) & lz_markers)


def _find_lz_functions(contract: Contract) -> list[str]:
    """Find LayerZero-related function names."""
    lz_keywords = ["send", "lzReceive", "debit", "credit", "quote", "compose"]
    return [
        fn.name for fn in contract.functions
        if any(kw.lower() in fn.name.lower() for kw in lz_keywords)
    ]


def _has_payment_pattern(contract: Contract) -> bool:
    """Check if contract has agent-payment patterns."""
    fn_names = {fn.name for fn in contract.functions}
    all_var_names = {sv.name for sv in contract.state_variables}
    has_payment_fn = bool(fn_names & PAYMENT_FUNCTIONS)
    has_sig_pattern = any(
        "signature" in sv.name.lower() or "sig" in sv.name.lower() or "nonce" in sv.name.lower()
        for sv in contract.state_variables
    )
    return has_payment_fn or (has_sig_pattern and len(fn_names & {"execute", "verify", "validate"}) > 0)


def _find_payment_functions(contract: Contract) -> list[str]:
    """Find payment-related function names."""
    return [
        fn.name for fn in contract.functions
        if fn.name in PAYMENT_FUNCTIONS
        or any(kw in fn.name.lower() for kw in ["pay", "claim", "release", "disburse"])
    ]
