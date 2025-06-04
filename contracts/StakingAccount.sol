// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingI } from "./precompiles/staking/StakingI.sol";
import { DistributionI } from "./precompiles/distribution/DistributionI.sol";
import { Coin } from "./precompiles/common/Types.sol";

/// @title StakingAccount
contract StakingAccount {

    // === ERRORS ===

    error OnlyVestingContract();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 balance, uint256 required);
    error FailedToSendFunds();
    error FailedToCallStaking(bytes data);
    error FailedToCallDistribution(bytes result);

    // === STATE VARIABLES ===

    address public vestingContract;

    // TODO: remove from state and move to const variables
    StakingI public stakingContract;
    DistributionI public distributionContract;

    // === END OF STATE VARIABLES ===

    constructor(address _stakingContract, address _distributionContract) {
        vestingContract = msg.sender;
        stakingContract = StakingI(_stakingContract);
        distributionContract = DistributionI(_distributionContract);
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
        address payable to,
        string memory validatorAddress
    ) external onlyVestingContract nonZeroAddress(to) {
        // Withdraw the rewards from the validator
        Coin[] memory rewards = distributionContract.withdrawDelegatorRewards(address(this), validatorAddress);

        if (rewards[0].amount > 0) {
            // Transfer the rewards to the specified address
            (bool success, ) = to.call{ value: rewards[0].amount }("");
            if (!success) {
                revert FailedToSendFunds();
            }
        }
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
    function withdrawUndelegatedTokens(
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

    /// @dev Fuction to call any view function on the Staking contract
    /// @param data The data to call the view function with.
    function callStakingViewFunction(
        bytes memory data
    ) external view returns (bytes memory) {
        (bool success, bytes memory result) = address(stakingContract).staticcall(data);
        if (!success) {
            revert FailedToCallStaking(result);
        }
        return result;
    }

    /// @dev Fuction to call any view function on the Distribution contract
    /// @param data The data to call the view function with.
    function callDistributionViewFunction(
        bytes memory data
    ) external view returns (bytes memory) {
        (bool success, bytes memory result) = address(distributionContract).staticcall(data);
        if (!success) {
            revert FailedToCallDistribution(result);
        }
        return result;
    }

}