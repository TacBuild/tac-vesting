// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "../precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "../precompiles/distribution/DistributionI.sol";

import { StakingMock } from "../mock/StakingMock.sol";

import { Coin, DecCoin } from "../precompiles/common/Types.sol";

import { TacHeaderV1 } from "@tonappchain/evm-ccl/contracts/core/Structs.sol";

import { TacVesting } from "../TacVesting.sol";

import { ISAFactory } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ISAFactory.sol";
import { ITacSmartAccount } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ITacSmartAccount.sol";

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
        (address sa, bool isNewAccount) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        require(isNewAccount, "TacVesting: SmartAccount already exists");
        userInfo.smartAccount = ITacSmartAccount(sa);
        userInfo.validatorAddress = params.validatorAddress;

        // Delegate the tokens to the validator
        bytes memory ret = userInfo.smartAccount.execute{value: params.userTotalRewards}(
            STAKING_PRECOMPILE_ADDRESS,
            params.userTotalRewards, // send TAC to staking mock
            abi.encodeWithSelector(
                StakingI.delegate.selector,
                address(userInfo.smartAccount),
                params.validatorAddress,
                params.userTotalRewards
            )
        );
        bool success = abi.decode(ret, (bool));
        require(success, "TacVesting: Failed to delegate tokens");

        emit Delegated(tacHeader.tvmCaller, params.validatorAddress, params.userTotalRewards);
    }
}