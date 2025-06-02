// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { TacVesting } from "../TacVesting.sol";
import { StakingAccountTest } from "./StakingAccountTest.sol";

contract TacVestingTest is TacVesting {
    function initialize(
        address _adminAddress,
        address _stakingContract,
        address _distributionContract,
        uint256 _stepDuration
    ) override initializer public {
         require(_adminAddress != address(0), "TacVesting: Admin address cannot be zero");
        __UUPSUpgradeable_init();
        __Ownable_init(_adminAddress);
        __ReentrancyGuard_init();

        require(_stakingContract != address(0), "TacVesting: Staking contract cannot be zero");
        require(_distributionContract != address(0), "TacVesting: Distribution contract cannot be zero");
        stakingContract = _stakingContract;
        distributionContract = _distributionContract;
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
        require(userInfo.choiceStartTime == 0, "TacVesting: User has already made a choice");
        userInfo.choiceStartTime = uint40(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.stakingAccount = new StakingAccountTest(stakingContract, distributionContract);
        if (address(userInfo.stakingAccount) == address(0)) {
            revert("TacVesting: Failed to create StakingAccount");
        }
        // Delegate the tokens to the validator
        userInfo.stakingAccount.delegate{value: userTotalRewards}(validatorAddress);
    }
}