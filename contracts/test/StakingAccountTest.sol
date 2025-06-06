// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingAccount } from "../StakingAccount.sol";
import { StakingMock } from "../mock/StakingMock.sol";

contract StakingAccountTest is StakingAccount {
    // redeclare delegate function for call staking mock payable function
    function delegate(
        string memory validatorAddress
    ) external override payable onlyVestingContract nonZeroAmount(msg.value) {
        // Delegate the tokens to the validator
        StakingMock(address(stakingContract)).delegate{ value: msg.value }(address(this), validatorAddress, msg.value);
    }
}