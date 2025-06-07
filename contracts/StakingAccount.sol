// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "./precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "./precompiles/distribution/DistributionI.sol";
import { Coin, DecCoin } from "./precompiles/common/Types.sol";

/// @title StakingAccount
contract StakingAccount {

    // === ERRORS ===

    error OnlyVestingContract();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 balance, uint256 required);
    error FailedToSendFunds();

    // === CONSTANTS ===

    StakingI public constant stakingContract = StakingI(STAKING_PRECOMPILE_ADDRESS);
    DistributionI public constant distributionContract = DistributionI(DISTRIBUTION_PRECOMPILE_ADDRESS);

    // === STATE VARIABLES ===

    address public vestingContract;

    // === END OF STATE VARIABLES ===

    constructor() {
        // Set the vesting contract address
        vestingContract = msg.sender;
    }

    modifier onlyVestingContract() {
        if (msg.sender != vestingContract) {
            revert OnlyVestingContract();
        }
        _;
    }

    modifier nonZeroAmount(uint256 amount) {
        if (amount == 0) {
            revert ZeroAmount();
        }
        _;
    }

    modifier nonZeroAddress(address addr) {
        if (addr == address(0)) {
            revert ZeroAddress();
        }
        _;
    }

    receive() external payable {
        // This function allows the contract to receive Ether from the staking contract
    }

    /// @dev Function to delegate tokens
    /// @param validatorAddress The address of the validator to delegate to.
    function delegate(
        string memory validatorAddress
    ) external payable virtual onlyVestingContract nonZeroAmount(msg.value) { // TODO: remove virtual modifier
        // Delegate the tokens to the validator
        stakingContract.delegate(address(this), validatorAddress, msg.value);
    }

    /// @dev Function to withdraw rewards
    /// @param validatorAddress The address of the validator to withdraw rewards from.
    function withdrawRewards(
        address to,
        string memory validatorAddress
    ) external onlyVestingContract nonZeroAddress(to) returns (uint256) {

        // Check if the contract has active delegations
        (, Coin memory balance) = stakingContract.delegation(address(this), validatorAddress);
        if (balance.amount == 0) { // if no delegation found - just return 0
            return 0;
        }
        // Withdraw the rewards from the validator
        Coin[] memory rewards = distributionContract.withdrawDelegatorRewards(address(this), validatorAddress);

        if (rewards[0].amount > 0) {
            // Transfer rewards to the specified address
            (bool success, ) = to.call{ value: rewards[0].amount }("");
            if (!success) {
                revert FailedToSendFunds();
            }
        }

        return rewards[0].amount;
    }

    /// @dev Function to undelegate tokens
    /// @param validatorAddress The address of the validator to undelegate from.
    /// @param amount The amount of tokens to undelegate.
    /// @return completionTime The time when the undelegation is completed
    function undelegate(
        string memory validatorAddress,
        uint256 amount
    ) external onlyVestingContract nonZeroAmount(amount) returns (int64) {
        // Undelegate the tokens from the validator
        return stakingContract.undelegate(address(this), validatorAddress, amount);
    }

    /// @dev Withdraw the undelegated tokens
    /// @param to The address to withdraw the undelegated tokens to.
    function withdraw(
        address to,
        uint256 amount
    ) external onlyVestingContract nonZeroAddress(to) nonZeroAmount(amount) {
        if (address(this).balance < amount) {
            revert InsufficientBalance(address(this).balance, amount);
        }

        // Transfer the undelegated tokens to the specified address
        (bool success, ) = to.call{ value: amount }("");
        if (!success) {
            revert FailedToSendFunds();
        }
    }
}