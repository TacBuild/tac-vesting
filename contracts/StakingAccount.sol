// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "./precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "./precompiles/distribution/DistributionI.sol";
import { Coin, DecCoin } from "./precompiles/common/Types.sol";

/// @title StakingAccount
contract StakingAccount {

    // === ERRORS ===

    error OnlyDeployer();
    error DelegationWasMade();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 balance, uint256 required);
    error FailedToSendFunds();

    // === CONSTANTS ===

    StakingI public constant stakingContract = StakingI(STAKING_PRECOMPILE_ADDRESS);
    DistributionI public constant distributionContract = DistributionI(DISTRIBUTION_PRECOMPILE_ADDRESS);

    // === STATE VARIABLES ===

    address public deployer;

    // === END OF STATE VARIABLES ===

    constructor() {
        deployer = msg.sender;
    }

    modifier onlyDeployer() {
        if (msg.sender != deployer) {
            revert OnlyDeployer();
        }
        _;
    }

    modifier nonZeroAmount(uint256 amount) {
        if (amount == 0) {
            revert ZeroAmount();
        }
        _;
    }

    receive() external payable {
        // This function allows the contract to receive TAC from the staking/distribution modules
    }

    /// @dev Function to delegate tokens
    /// @param validatorAddress The address of the validator to delegate to.
    function delegate(
        string calldata validatorAddress
    ) external payable virtual onlyDeployer nonZeroAmount(msg.value) returns(bool) { // TODO: remove virtual modifier

        // Delegate the tokens to the validator
        return stakingContract.delegate(address(this), validatorAddress, msg.value);
    }

    /// @dev Function to withdraw rewards
    /// @param validatorAddress The address of the validator to withdraw rewards from.
    function withdrawRewards(string calldata validatorAddress) external onlyDeployer returns (uint256) {
        // Withdraw the rewards from the validator
        Coin[] memory rewards = distributionContract.withdrawDelegatorRewards(address(this), validatorAddress);

        if (rewards[0].amount > 0) {
            (bool success, ) = (msg.sender).call{ value: rewards[0].amount }("");
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
        string calldata validatorAddress,
        uint256 amount
    ) external onlyDeployer nonZeroAmount(amount) returns (int64) {
        // Undelegate the tokens from the validator
        return stakingContract.undelegate(address(this), validatorAddress, amount);
    }

    /// @dev Function to redelegate tokens from one validator to another
    /// @param validatorSrcAddress The address of the source validator.
    /// @param validatorDstAddress The address of the destination validator.
    /// @param amount The amount of tokens to redelegate.
    /// @return completionTime The time when the redelegation is completed
    function redelegate(
        string calldata validatorSrcAddress,
        string calldata validatorDstAddress,
        uint256 amount
    ) external onlyDeployer nonZeroAmount(amount) returns (int64) {
        // Redelegate the tokens from one validator to another
        return stakingContract.redelegate(address(this), validatorSrcAddress, validatorDstAddress, amount);
    }

    /// @dev Withdraw all available funds (undelegated and rewards) from the staking account
    function withdraw() external onlyDeployer returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) {
            return 0; // No funds to withdraw
        }
        // Transfer the undelegated tokens
        (bool success, ) = (msg.sender).call{ value: amount }("");
        if (!success) {
            revert FailedToSendFunds();
        }
    }
}