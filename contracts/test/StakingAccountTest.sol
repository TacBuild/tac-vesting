// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingAccount } from "../StakingAccount.sol";
import { StakingMock } from "../mock/StakingMock.sol";

contract StakingAccountTest is StakingAccount {
    // redeclare delegate function for call staking mock payable function
    function delegate(
        string calldata _validatorAddress
    ) external override payable onlyVestingContract nonZeroAmount(msg.value) returns(bool) {
        // Delegate the tokens to the validator
        if (bytes(validatorAddress).length > 0) {
            revert DelegationWasMade();
        }
        validatorAddress = _validatorAddress;
        return StakingMock(address(stakingContract)).delegate{ value: msg.value }(address(this), _validatorAddress, msg.value);
    }
}