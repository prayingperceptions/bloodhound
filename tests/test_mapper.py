"""
tests/test_mapper.py — Unit tests for the Bloodhound mapper skill.
"""

import json
import sys
import tempfile
from pathlib import Path

import pytest

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))

from core.state_map import StateMap, Contract, StateVariable, FunctionFlow
from core.solidity_parser import extract_contracts, _strip_comments, _parse_params
from core.heuristics import auto_generate_invariants, detect_anomalies


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

SAMPLE_VAULT = """
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract SimpleVault is ERC20 {
    mapping(address => uint256) public userDeposits;
    uint256 public totalDeposited;
    address public asset;

    constructor(address _asset) ERC20("Vault", "vTKN") {
        asset = _asset;
    }

    function deposit(uint256 amount) external {
        userDeposits[msg.sender] += amount;
        totalDeposited += amount;
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        _mint(msg.sender, convertToShares(amount));
    }

    function withdraw(uint256 shares) external {
        uint256 amount = convertToAssets(shares);
        userDeposits[msg.sender] -= amount;
        totalDeposited -= amount;
        _burn(msg.sender, shares);
        IERC20(asset).transfer(msg.sender, amount);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = totalSupply();
        return supply == 0 ? assets : assets * supply / totalAssets();
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        return shares * totalAssets() / totalSupply();
    }
}
"""


@pytest.fixture
def sample_repo(tmp_path):
    """Create a minimal Solidity project."""
    src = tmp_path / "src"
    src.mkdir()
    (src / "SimpleVault.sol").write_text(SAMPLE_VAULT)
    return tmp_path


@pytest.fixture
def sample_state_map():
    """Create a pre-populated StateMap for testing."""
    vault = Contract(
        name="SimpleVault",
        file_path="src/SimpleVault.sol",
        inherits=["ERC20"],
        state_variables=[
            StateVariable(name="userDeposits", var_type="mapping(address => uint256)", is_mapping=True),
            StateVariable(name="totalDeposited", var_type="uint256"),
            StateVariable(name="asset", var_type="address"),
        ],
        functions=[
            FunctionFlow(
                name="deposit", contract="SimpleVault",
                visibility="external", mutability="nonpayable",
                writes=["userDeposits", "totalDeposited"],
                external_calls=["IERC20.transferFrom"],
                parameters=[{"type": "uint256", "name": "amount"}],
            ),
            FunctionFlow(
                name="withdraw", contract="SimpleVault",
                visibility="external", mutability="nonpayable",
                writes=["userDeposits", "totalDeposited"],
                external_calls=["IERC20.transfer"],
                parameters=[{"type": "uint256", "name": "shares"}],
            ),
            FunctionFlow(
                name="totalAssets", contract="SimpleVault",
                visibility="public", mutability="view",
            ),
            FunctionFlow(
                name="convertToShares", contract="SimpleVault",
                visibility="public", mutability="view",
                parameters=[{"type": "uint256", "name": "assets"}],
            ),
            FunctionFlow(
                name="convertToAssets", contract="SimpleVault",
                visibility="public", mutability="view",
                parameters=[{"type": "uint256", "name": "shares"}],
            ),
        ],
    )
    return StateMap(
        protocol_name="TestVault",
        repo_path="/tmp/test",
        contracts=[vault],
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestSolidityParser:
    def test_extract_contracts_finds_sol_files(self, sample_repo):
        contracts = extract_contracts(sample_repo)
        assert len(contracts) >= 1
        names = {c.name for c in contracts}
        assert "SimpleVault" in names

    def test_extract_contracts_parses_functions(self, sample_repo):
        contracts = extract_contracts(sample_repo)
        vault = next(c for c in contracts if c.name == "SimpleVault")
        fn_names = {f.name for f in vault.functions}
        assert "deposit" in fn_names
        assert "withdraw" in fn_names

    def test_extract_contracts_parses_state_vars(self, sample_repo):
        contracts = extract_contracts(sample_repo)
        vault = next(c for c in contracts if c.name == "SimpleVault")
        var_names = {sv.name for sv in vault.state_variables}
        assert "totalDeposited" in var_names

    def test_strip_comments(self):
        source = "uint x = 1; // inline comment\n/* block */ uint y = 2;"
        cleaned = _strip_comments(source)
        assert "//" not in cleaned
        assert "/* block */" not in cleaned
        assert "uint x = 1;" in cleaned
        assert "uint y = 2;" in cleaned

    def test_parse_params(self):
        params = _parse_params("uint256 amount, address to")
        assert len(params) == 2
        assert params[0]["type"] == "uint256"
        assert params[1]["name"] == "to"

    def test_parse_empty_params(self):
        assert _parse_params("") == []
        assert _parse_params("   ") == []


class TestHeuristics:
    def test_auto_generate_vault_invariants(self, sample_state_map):
        invariants = auto_generate_invariants(sample_state_map)
        assert len(invariants) >= 2  # At least totalAssets and no-value-loss
        categories = {inv.category for inv in invariants}
        assert "economic" in categories

    def test_detect_anomalies_missing_reentrancy(self, sample_state_map):
        # Add invariants first (required by detect_anomalies)
        sample_state_map.invariants = auto_generate_invariants(sample_state_map)
        anomalies = detect_anomalies(sample_state_map)
        # deposit and withdraw have external calls + writes but no nonReentrant
        reentrancy_anoms = [a for a in anomalies if a.anomaly_type == "missing_reentrancy_guard"]
        assert len(reentrancy_anoms) >= 1

    def test_detect_anomalies_rounding_risk(self, sample_state_map):
        sample_state_map.invariants = auto_generate_invariants(sample_state_map)
        anomalies = detect_anomalies(sample_state_map)
        rounding = [a for a in anomalies if a.anomaly_type == "rounding_risk"]
        assert len(rounding) >= 1  # convertToShares / convertToAssets


class TestStateMap:
    def test_serialization_roundtrip(self, sample_state_map, tmp_path):
        path = tmp_path / "test_map.json"
        sample_state_map.to_json(path)
        loaded = StateMap.from_json(path)
        assert loaded.protocol_name == "TestVault"
        assert len(loaded.contracts) == 1
        assert loaded.contracts[0].name == "SimpleVault"

    def test_get_external_entrypoints(self, sample_state_map):
        entrypoints = sample_state_map.get_external_entrypoints()
        names = {f.name for f in entrypoints}
        assert "deposit" in names
        assert "withdraw" in names
        # view functions should be excluded
        assert "totalAssets" not in names

    def test_mermaid_diagram(self, sample_state_map):
        diagram = sample_state_map.generate_mermaid_diagram()
        assert "graph TD" in diagram
        assert "SimpleVault" in diagram
