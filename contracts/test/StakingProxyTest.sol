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

import "hardhat/console.sol";

/// @title StakingProxyTest
contract StakingProxyTest is StakingProxy {
    ///@dev Function to delegate tokens to a validator
    function delegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external payable override _onlyCrossChainLayer {
        console.log("StakingProxyTest");
        console.log("Decode TAC header");
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        console.log("Decode parameters");
        DelegateParams memory params = abi.decode(_params, (DelegateParams));

        console.log("Params:");
        console.log("  Validator Address: %s", params.validatorAddress);
        console.log("  Amount: %s", params.amount);

        // Get or create the Smart Account for the user
        console.log("Get or create Smart Account for user: %s", tacHeader.tvmCaller);
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);

        console.log("Smart Account Address: %s", sa);

        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        console.log("Execute delegation on Smart Account: %s", address(smartAccount));
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
