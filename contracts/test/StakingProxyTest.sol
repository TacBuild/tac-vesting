// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "../precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "../precompiles/distribution/DistributionI.sol";
import { Coin, DecCoin } from "../precompiles/common/Types.sol";

import { TacHeaderV1, OutMessageV1, TokenAmount, NFTAmount } from "@tonappchain/evm-ccl/contracts/core/Structs.sol";
import { TacProxyV1Upgradeable } from "@tonappchain/evm-ccl/contracts/proxies/TacProxyV1Upgradeable.sol";

import { ISAFactory } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ISAFactory.sol";
import { ITacSmartAccount } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ITacSmartAccount.sol";

import { StakingProxy } from "../StakingProxy.sol";

/// @title StakingProxyTest
contract StakingProxyTest is StakingProxy {
    ///@dev Function to delegate tokens to a validator
    function delegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external override _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        DelegateParams memory params = abi.decode(_params, (DelegateParams));

        // Get or create the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Delegate the tokens to the validator
        bytes memory ret = smartAccount.execute{value: params.amount}(
            STAKING_PRECOMPILE_ADDRESS,
            params.amount, // send TAC to staking mock
            abi.encodeWithSelector(
                StakingI.delegate.selector,
                address(smartAccount),
                params.validatorAddress,
                params.amount
            )
        );
        bool success = abi.decode(ret, (bool));
        require(success, "StakingProxy: Failed to delegate tokens");

        emit Delegated(
            tacHeader.tvmCaller,
            params.validatorAddress,
            params.amount
        );
    }
}
