"""
tests/test_fuzz.py — Unit tests for the Bloodhound fuzzer skill.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.state_map import (
    Contract, EconomicInvariant, ExploitHypothesis,
    FunctionFlow, StateMap, StateVariable,
)
from skills.bloodhound_fuzz import (
    _generate_inline_test,
    _identify_target_contracts,
    generate_standalone_test,
)


@pytest.fixture
def hypothesis():
    return ExploitHypothesis(
        id="HYPO-001",
        description="Reentrancy in deposit enables share inflation",
        chain=["Vault.deposit(1000)", "Vault.withdraw(allShares)"],
        violated_invariant="INV-001",
        economic_impact="Drain vault",
        confidence=0.8,
        anomalies_used=["ANOM-001"],
    )


@pytest.fixture
def state_map():
    vault = Contract(
        name="Vault",
        file_path="src/Vault.sol",
        functions=[
            FunctionFlow(
                name="deposit", contract="Vault",
                visibility="external", mutability="nonpayable",
                parameters=[{"type": "uint256", "name": "amount"}],
                writes=["totalDeposited"],
            ),
            FunctionFlow(
                name="withdraw", contract="Vault",
                visibility="external", mutability="nonpayable",
                parameters=[{"type": "uint256", "name": "shares"}],
                writes=["totalDeposited"],
            ),
        ],
    )
    return StateMap(
        protocol_name="TestVault",
        repo_path="/tmp/test",
        contracts=[vault],
        invariants=[
            EconomicInvariant(
                id="INV-001",
                description="Total assets >= deposits",
                expression="totalAssets() >= totalDeposited",
                severity_if_violated="Critical",
            ),
        ],
    )


class TestInlineTestGeneration:
    def test_generates_valid_solidity(self, hypothesis, state_map):
        invariant = state_map.invariants[0]
        targets = {"Vault": state_map.contracts[0].functions}

        code = _generate_inline_test(hypothesis, invariant, targets, state_map)

        assert "pragma solidity" in code
        assert "PoC_Bloodhound" in code
        assert "invariant_" in code
        assert "forge-std/Test.sol" in code

    def test_includes_hypothesis_id(self, hypothesis, state_map):
        invariant = state_map.invariants[0]
        targets = {"Vault": state_map.contracts[0].functions}

        code = _generate_inline_test(hypothesis, invariant, targets, state_map)
        assert "HYPO_001" in code

    def test_generates_handler_functions(self, hypothesis, state_map):
        invariant = state_map.invariants[0]
        targets = {"Vault": state_map.contracts[0].functions}

        code = _generate_inline_test(hypothesis, invariant, targets, state_map)
        assert "function deposit" in code
        assert "function withdraw" in code
        assert "bound(" in code


class TestTargetIdentification:
    def test_identifies_from_chain(self, hypothesis, state_map):
        targets = _identify_target_contracts(hypothesis, state_map)
        assert "Vault" in targets
        fn_names = {f.name for f in targets["Vault"]}
        assert "deposit" in fn_names

    def test_fallback_to_entrypoints(self, state_map):
        empty_hyp = ExploitHypothesis(
            id="X", description="", chain=[],
            violated_invariant="", economic_impact="", confidence=0.5,
        )
        targets = _identify_target_contracts(empty_hyp, state_map)
        assert len(targets) > 0


class TestStandaloneGeneration:
    def test_generates_standalone_test(self, state_map, tmp_path):
        # Create a fake repo structure
        test_dir = tmp_path / "test"
        test_dir.mkdir()
        state_map.repo_path = str(tmp_path)

        path = generate_standalone_test(state_map, tmp_path)
        assert path.exists()

        content = path.read_text()
        assert "invariant_" in content
        assert "INV_001" in content
