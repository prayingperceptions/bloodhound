"""
tests/test_reasoner.py — Unit tests for the Bloodhound reasoner skill.
"""

import json
import sys
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from core.state_map import (
    Anomaly, Contract, EconomicInvariant, ExploitHypothesis,
    FunctionFlow, StateMap, StateVariable,
)
from skills.bloodhound_reasoner import (
    _parse_response, _build_analysis_prompt, _heuristic_fallback,
    _detect_provider, LLMProvider,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def state_map_with_anomalies():
    vault = Contract(
        name="Vault",
        file_path="src/Vault.sol",
        functions=[
            FunctionFlow(
                name="deposit", contract="Vault",
                visibility="external", mutability="nonpayable",
                writes=["totalDeposited"],
                external_calls=["IERC20.transferFrom"],
                parameters=[{"type": "uint256", "name": "amount"}],
            ),
        ],
        state_variables=[
            StateVariable(name="totalDeposited", var_type="uint256"),
        ],
    )
    sm = StateMap(
        protocol_name="TestProtocol",
        repo_path="/tmp/test",
        contracts=[vault],
        invariants=[
            EconomicInvariant(
                id="INV-001",
                description="Total assets must equal sum of deposits",
                expression="totalAssets() >= totalDeposited",
                severity_if_violated="Critical",
            ),
        ],
        anomalies=[
            Anomaly(
                id="ANOM-001",
                description="Missing reentrancy guard on Vault::deposit",
                location="Vault::deposit",
                anomaly_type="missing_reentrancy_guard",
                severity_hint="High",
            ),
            Anomaly(
                id="ANOM-002",
                description="Rounding risk in Vault::convertToShares",
                location="Vault::convertToShares",
                anomaly_type="rounding_risk",
                severity_hint="Medium",
            ),
        ],
    )
    return sm


MOCK_LLM_RESPONSE = """
Here are the exploit chains I found:

```json
[
  {
    "id": "HYPO-001",
    "description": "Reentrancy in deposit combined with rounding in convertToShares allows share inflation",
    "chain": ["Vault.deposit(1000)", "Vault.convertToShares(0)", "Vault.withdraw(allShares)"],
    "violated_invariant": "INV-001",
    "economic_impact": "Drain entire vault balance via share inflation attack",
    "confidence": 0.8,
    "anomalies_used": ["ANOM-001", "ANOM-002"]
  }
]
```
"""


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestResponseParsing:
    def test_parse_valid_json_in_codeblock(self):
        hyps = _parse_response(MOCK_LLM_RESPONSE)
        assert len(hyps) == 1
        assert hyps[0].id == "HYPO-001"
        assert hyps[0].confidence == 0.8
        assert len(hyps[0].chain) == 3

    def test_parse_raw_json(self):
        raw = '[{"id": "H1", "description": "test", "chain": [], "violated_invariant": "INV-001", "economic_impact": "none", "confidence": 0.5, "anomalies_used": []}]'
        hyps = _parse_response(raw)
        assert len(hyps) == 1

    def test_parse_empty_array(self):
        assert _parse_response("```json\n[]\n```") == []

    def test_parse_garbage(self):
        assert _parse_response("this is not json at all") == []

    def test_filters_low_confidence(self):
        raw = '[{"id": "H1", "description": "t", "chain": [], "violated_invariant": "X", "economic_impact": "n", "confidence": 0.1, "anomalies_used": []}]'
        assert _parse_response(raw) == []


class TestPromptConstruction:
    def test_prompt_includes_protocol_name(self, state_map_with_anomalies):
        prompt = _build_analysis_prompt(
            state_map_with_anomalies,
            state_map_with_anomalies.anomalies,
        )
        assert "TestProtocol" in prompt

    def test_prompt_includes_anomalies(self, state_map_with_anomalies):
        prompt = _build_analysis_prompt(
            state_map_with_anomalies,
            state_map_with_anomalies.anomalies,
        )
        assert "ANOM-001" in prompt
        assert "ANOM-002" in prompt

    def test_prompt_includes_invariants(self, state_map_with_anomalies):
        prompt = _build_analysis_prompt(
            state_map_with_anomalies,
            state_map_with_anomalies.anomalies,
        )
        assert "INV-001" in prompt


class TestProviderDetection:
    def test_explicit_provider(self):
        assert _detect_provider({"provider": "openai"}) == LLMProvider.OPENAI

    @patch.dict("os.environ", {"GEMINI_API_KEY": "test"})
    def test_detect_gemini_from_env(self):
        assert _detect_provider({}) == LLMProvider.GEMINI

    @patch.dict("os.environ", {"OPENAI_API_KEY": "test"}, clear=True)
    def test_detect_openai_from_env(self):
        # Clear GEMINI_API_KEY to ensure OpenAI is picked
        assert _detect_provider({}) == LLMProvider.OPENAI


class TestHeuristicFallback:
    def test_fallback_with_multiple_anomalies(self, state_map_with_anomalies):
        hyps = _heuristic_fallback(
            state_map_with_anomalies,
            state_map_with_anomalies.anomalies,
        )
        assert len(hyps) >= 1
        assert hyps[0].confidence >= 0.3
