// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { TacVesting } from "../TacVesting.sol";
import { StakingAccountTest } from "./StakingAccountTest.sol";

contract TacVestingTest is TacVesting {
    function initialize(
        address _adminAddress,
        uint256 _stepDuration
    ) override initializer public {
         require(_adminAddress != address(0), "TacVesting: Admin address cannot be zero");
        __UUPSUpgradeable_init();
        __Ownable_init(_adminAddress);
        __ReentrancyGuard_init();

        stepDuration = _stepDuration;
    }

    // redeclare chooseStaking for deploy test staking account
    function chooseStaking(
        string memory validatorAddress,
        uint256 userTotalRewards,
        bytes32[] calldata merkleProof
    ) external override {
        checkProof(msg.sender, userTotalRewards, merkleProof);

        UserInfo storage userInfo = info[msg.sender];
        checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.stakingAccount = StakingAccountTest(payable(Create2.deploy(
            0,
            keccak256(abi.encode(msg.sender)),
            type(StakingAccountTest).creationCode
        )));
        if (address(userInfo.stakingAccount) == address(0)) {
            revert("TacVesting: Failed to create StakingAccount");
        }
        // Delegate the tokens to the validator
        userInfo.stakingAccount.delegate{value: userTotalRewards}(validatorAddress);

        emit Delegated(msg.sender, validatorAddress, userTotalRewards);
    }
}