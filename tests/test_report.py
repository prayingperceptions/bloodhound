"""
tests/test_report.py — Unit tests for the Bloodhound reporter skill.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.state_map import (
    ExploitHypothesis, Finding, StateMap,
)
from skills.bloodhound_report import (
    _render_c4_high, _render_immunefi,
    _generate_collapse_narrative, _get_template_env,
)


@pytest.fixture
def sample_finding():
    return Finding(
        id="FIND-001",
        title="Reentrancy in Vault::deposit enables share inflation",
        severity="High",
        description="The deposit function lacks a reentrancy guard while making an external call to IERC20.transferFrom. An attacker can re-enter deposit via a malicious token.",
        impact="Complete drainage of vault funds through share inflation attack.",
        proof_of_concept="function test_exploit() public {\n    vault.deposit{value: 1 ether}(1000);\n}",
        recommendation="Add a nonReentrant modifier to the deposit function.",
        contract="Vault",
        function="deposit",
        category="economic",
        forge_output="FAIL. Reason: assertion violation",
        hypothesis=ExploitHypothesis(
            id="HYPO-001",
            description="Chain reentrancy with rounding for share inflation",
            chain=["Vault.deposit(1000)", "Vault.convertToShares(0)", "Vault.withdraw(allShares)"],
            violated_invariant="INV-001",
            economic_impact="Drain entire vault balance",
            confidence=0.85,
            anomalies_used=["ANOM-001", "ANOM-002"],
        ),
    )


@pytest.fixture
def sample_state_map(sample_finding):
    return StateMap(
        protocol_name="TestProtocol",
        repo_path="/tmp/test",
        findings=[sample_finding],
    )


class TestCode4renaReport:
    def test_high_report_structure(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_c4_high(sample_finding, sample_state_map, env)

        assert "[High]" in report
        assert "Vulnerability Detail" in report
        assert "Impact" in report
        assert "Proof of Concept" in report
        assert "Recommendation" in report
        assert "Vault" in report

    def test_high_report_includes_poc(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_c4_high(sample_finding, sample_state_map, env)
        assert "vault.deposit" in report

    def test_high_report_includes_forge_output(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_c4_high(sample_finding, sample_state_map, env)
        assert "FAIL" in report


class TestImmunefiReport:
    def test_immunefi_report_structure(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_immunefi(sample_finding, sample_state_map, env)

        assert "Bug Description" in report
        assert "Vulnerability Details" in report
        assert "Impact" in report
        assert "Proof of Concept" in report
        assert "Recommendation" in report

    def test_immunefi_title_format(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_immunefi(sample_finding, sample_state_map, env)
        # Should follow [AttackVector] in Contract::Function leads to Impact
        assert "Vault" in report
        assert "deposit" in report

    def test_immunefi_collapse_path(self, sample_finding, sample_state_map):
        env = _get_template_env()
        report = _render_immunefi(sample_finding, sample_state_map, env)
        assert "Vault.deposit(1000)" in report
        assert "Economic Collapse Path" in report or "Collapse" in report


class TestCollapseNarrative:
    def test_with_chain(self, sample_finding):
        narrative = _generate_collapse_narrative(sample_finding)
        assert "Vault.deposit(1000)" in narrative
        assert "Drain entire vault balance" in narrative

    def test_without_chain(self):
        finding = Finding(
            id="F1", title="t", severity="High",
            description="d", impact="Loss of funds",
            proof_of_concept="", recommendation="r",
            contract="C", function="f",
        )
        narrative = _generate_collapse_narrative(finding)
        assert "Loss of funds" in narrative
