// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingMock } from "./StakingMock.sol";

/// @dev Coin is a struct that represents a token with a denomination and an amount.
struct Coin {
    string denom;
    uint256 amount;
}

contract DistributionMock {

    StakingMock public constant stakingContract = StakingMock(0x0000000000000000000000000000000000000800);
    uint256 public constant REWARDS_STEP_DURATION = 1 hours;
    uint256 public constant REWARDS_STEP_AMOUNT= 1 ether;

    /// @dev Withdraw the rewards of a delegator from a validator
    /// @param delegatorAddress The address of the delegator
    /// @param validatorAddress The address of the validator
    /// @return amount The amount of Coin withdrawn
    function withdrawDelegatorRewards(
        address delegatorAddress,
        string memory validatorAddress
    ) external returns (Coin[] memory amount) {
        StakingMock.Delegation memory delegation = stakingContract.getDelegation(delegatorAddress, validatorAddress);

        require(delegation.delegationTime > 0, "No delegation found");

        uint256 rewards = (block.timestamp - delegation.delegationTime) / REWARDS_STEP_DURATION * REWARDS_STEP_AMOUNT;
        require(rewards > 0, "No rewards to withdraw");

        // Simulate the withdrawal of rewards
        amount = new Coin[](1);
        amount[0] = Coin({
            denom: "stake",
            amount: rewards
        });

        // send rewards to the delegator
        (bool success, ) = delegatorAddress.call{ value: rewards }("");
        require(success, "Failed to send rewards");
    }


}