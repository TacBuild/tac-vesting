// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { TacHeaderV1 } from "@tonappchain/evm-ccl/contracts/core/Structs.sol";

import { TacVesting } from "../TacVesting.sol";
import { StakingAccountTest } from "./StakingAccountTest.sol";

contract TacVestingTest is TacVesting {

    /// @dev Function to create delegation instead immediate withdraw.
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded ChooseStakingParams struct.
    function chooseStaking(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external override _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        ChooseStakingParams memory params = abi.decode(_params, (ChooseStakingParams));

        _checkProof(tacHeader.tvmCaller, params.userTotalRewards, params.merkleProof);

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = params.userTotalRewards;
        userInfo.stakingAccount = StakingAccountTest(payable(Create2.deploy(
            0,
            keccak256(abi.encode(tacHeader.tvmCaller)),
            type(StakingAccountTest).creationCode
        )));
        require(address(userInfo.stakingAccount) != address(0), "TacVesting: Failed to create StakingAccount");
        userInfo.validatorAddress = params.validatorAddress;

        // Delegate the tokens to the validator
        bool success = userInfo.stakingAccount.delegate{value: params.userTotalRewards}(params.validatorAddress);
        require(success, "TacVesting: Failed to delegate tokens");

        emit Delegated(tacHeader.tvmCaller, params.validatorAddress, params.userTotalRewards);
    }
}