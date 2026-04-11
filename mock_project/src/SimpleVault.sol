// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract SimpleVault {
    mapping(address => uint256) public userDeposits;
    uint256 public totalDeposited;
    address public asset;

    constructor(address _asset) {
        asset = _asset;
    }

    function deposit(uint256 amount) external {
        userDeposits[msg.sender] += amount;
        totalDeposited += amount;
        IERC20(asset).transferFrom(msg.sender, address(this), amount);
    }

    function withdraw(uint256 amount) external {
        userDeposits[msg.sender] -= amount;
        totalDeposited -= amount;
        IERC20(asset).transfer(msg.sender, amount);
    }

    function totalAssets() public view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view returns (uint256) {
        return assets; // simplified
    }
}
