// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "./precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "./precompiles/distribution/DistributionI.sol";
import { Coin, DecCoin } from "./precompiles/common/Types.sol";

/// @title StakingAccount
contract StakingAccount {

    // === ERRORS ===

    error OnlyVestingContract();
    error DelegationWasMade();
    error ZeroAmount();
    error ZeroAddress();
    error InsufficientBalance(uint256 balance, uint256 required);
    error FailedToSendFunds();

    // === CONSTANTS ===

    StakingI public constant stakingContract = StakingI(STAKING_PRECOMPILE_ADDRESS);
    DistributionI public constant distributionContract = DistributionI(DISTRIBUTION_PRECOMPILE_ADDRESS);

    // === STATE VARIABLES ===

    address public vestingContract;
    string public validatorAddress;

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

    receive() external payable {
        // This function allows the contract to receive TAC from the staking/distribution modules
    }

    /// @dev Function to delegate tokens
    /// @param _validatorAddress The address of the validator to delegate to.
    function delegate(
        string calldata _validatorAddress
    ) external payable virtual onlyVestingContract nonZeroAmount(msg.value) returns(bool) { // TODO: remove virtual modifier
        if (bytes(validatorAddress).length > 0) {
            revert DelegationWasMade();
        }
        validatorAddress = _validatorAddress;
        // Delegate the tokens to the validator
        return stakingContract.delegate(address(this), _validatorAddress, msg.value);
    }

    /// @dev Function to withdraw rewards
    function withdrawRewards() external onlyVestingContract returns (uint256) {
        // Withdraw the rewards from the validator
        Coin[] memory rewards = distributionContract.withdrawDelegatorRewards(address(this), validatorAddress);

        if (rewards[0].amount > 0) {
            // Transfer rewards to the vesting contract
            (bool success, ) = (msg.sender).call{ value: rewards[0].amount }("");
            if (!success) {
                revert FailedToSendFunds();
            }
        }

        return rewards[0].amount;
    }

    /// @dev Function to undelegate tokens
    /// @param amount The amount of tokens to undelegate.
    /// @return completionTime The time when the undelegation is completed
    function undelegate(
        uint256 amount
    ) external onlyVestingContract nonZeroAmount(amount) returns (int64) {
        // Undelegate the tokens from the validator
        return stakingContract.undelegate(address(this), validatorAddress, amount);
    }

    /// @dev Withdraw all available funds (undelegated and rewards) from the staking account
    function withdraw() external onlyVestingContract returns (uint256 amount) {
        amount = address(this).balance;
        if (amount == 0) {
            return 0; // No funds to withdraw
        }
        // Transfer the undelegated tokens to the vesting contract
        (bool success, ) = (msg.sender).call{ value: amount }("");
        if (!success) {
            revert FailedToSendFunds();
        }
    }
}