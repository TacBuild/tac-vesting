// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import { StakingI, STAKING_PRECOMPILE_ADDRESS } from "./precompiles/staking/StakingI.sol";
import { DistributionI, DISTRIBUTION_PRECOMPILE_ADDRESS } from "./precompiles/distribution/DistributionI.sol";
import { Coin } from "./precompiles/common/Types.sol";

import { TacHeaderV1, OutMessageV1, TokenAmount, NFTAmount } from "@tonappchain/evm-ccl/contracts/core/Structs.sol";
import { TacProxyV1Upgradeable } from "@tonappchain/evm-ccl/contracts/proxies/TacProxyV1Upgradeable.sol";

import { ISAFactory } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ISAFactory.sol";
import { ITacSmartAccount } from "@tonappchain/evm-ccl/contracts/smart-account/interfaces/ITacSmartAccount.sol";

/// @title StakingProxy
/// @dev This contract is a proxy for the Staking precompile, allowing users to delegate and undelegate tokens via cross-chain
contract StakingProxy is
    TacProxyV1Upgradeable,
    Ownable2StepUpgradeable,
    UUPSUpgradeable
{
    // === EVENTS ===
    /// @dev Emitted when tokens are delegated to a validator
    /// @param tvmCaller The address of the caller in the TVM
    /// @param validatorAddress The address of the validator to which tokens are delegated
    /// @param amount The amount of tokens delegated
    event Delegated(
        string tvmCaller,
        string validatorAddress,
        uint256 amount
    );

    /// @dev Emitted when tokens are undelegated from a validator
    /// @param tvmCaller The address of the caller in the TVM
    /// @param validatorAddress The address of the validator from which tokens are undelegated
    /// @param amount The amount of tokens undelegated
    /// @param completionTime The time when the undelegation will be completed
    event Undelegated(
        string tvmCaller,
        string validatorAddress,
        uint256 amount,
        int64 completionTime
    );

    /// @dev Emitted when tokens are redelegated from one validator to another
    /// @param tvmCaller The address of the caller in the TVM
    /// @param oldValidatorAddress The address of the validator from which tokens are redelegated
    /// @param newValidatorAddress The address of the validator to which tokens are redelegated
    /// @param amount The amount of tokens redelegated
    /// @param completionTime The time when the redelegation will be completed
    event Redelegated(
        string tvmCaller,
        string oldValidatorAddress,
        string newValidatorAddress,
        uint256 amount,
        int64 completionTime
    );

    /// @dev Emitted when rewards are withdrawn from a validator
    /// @param tvmCaller The address of the caller in the TVM
    /// @param validatorAddress The address of the validator from which rewards are withdrawn
    /// @param amount The amount of rewards withdrawn
    event WithdrawnDelegatorRewards(
        string tvmCaller,
        string validatorAddress,
        uint256 amount
    );

    // === CONSTANTS ===

    // === STATE VARIABLES ===
    /// @dev The address of the Smart Account Factory
    ISAFactory public saFactory;

    // === END OF STATE VARIABLES ===

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @dev Initializes the contract with the addresses of the Staking and Distribution precompiles and the Smart Account Factory
    function initialize(
        address _crossChainLayer,
        address _saFactory,
        address _adminAddress
    ) external initializer {
        require(
            _crossChainLayer != address(0),
            "StakingProxy: Invalid cross-chain layer address"
        );
        require(
            _saFactory != address(0),
            "StakingProxy: Invalid Smart Account Factory address"
        );
        require(
            _adminAddress != address(0),
            "StakingProxy: Invalid admin address"
        );

        __TacProxyV1Upgradeable_init(_crossChainLayer);
        __Ownable2Step_init();
        __Ownable_init(_adminAddress);
        __UUPSUpgradeable_init();

        saFactory = ISAFactory(_saFactory);
    }

    /// @dev Function to upgrade the contract implementation
    function _authorizeUpgrade(address newImplementation)
        internal
        override
        onlyOwner {}

    receive() external payable {
        // This function is required to receive TAC from the Smart Account
        // when users withdraw their balance.
    }

    //================================================================
    // INTERNAL FUNCTIONS
    //================================================================

    function _bridgeToTon(
        TacHeaderV1 memory tacHeader,
        uint256 amount
    ) internal {
        OutMessageV1 memory outMessage = OutMessageV1({
            shardsKey: tacHeader.shardsKey,
            tvmTarget: tacHeader.tvmCaller,
            tvmPayload: "",
            tvmProtocolFee: 0,
            tvmExecutorFee: 0,
            tvmValidExecutors: new string[](0),
            toBridge: new TokenAmount[](0),
            toBridgeNFT: new NFTAmount[](0)
        });

        _sendMessageV1(outMessage, amount);
    }


    //================================================================
    // USER's FUNCTIONS
    //================================================================

    /// @dev DelegateParams struct to hold the parameters for delegation
    /// @param validatorAddress The address of the validator to delegate to
    /// @param amount The amount to delegate
    struct DelegateParams {
        string validatorAddress; // The address of the validator to delegate to
        uint256 amount; // The amount to delegate
    }
    ///@dev Function to delegate tokens to a validator
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded DelegateParams struct.
    function delegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external payable virtual _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        DelegateParams memory params = abi.decode(_params, (DelegateParams));

        // Get or create the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Delegate the tokens to the validator
        bytes memory ret = smartAccount.execute{value: params.amount}(
            STAKING_PRECOMPILE_ADDRESS,
            0, // do not send TAC to staking precompile
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

    /// @dev UndelegateParams struct to hold the parameters for undelegation
    /// @param validatorAddress The address of the validator to undelegate from
    /// @param amount The amount to undelegate
    struct UndelegateParams {
        string validatorAddress; // The address of the validator to undelegate from
        uint256 amount; // The amount to undelegate
    }

    /// @dev Function to undelegate tokens from a validator
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded UndelegateParams struct.
    function undelegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        UndelegateParams memory params = abi.decode(_params, (UndelegateParams));

        // Get or create the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Undelegate the tokens from the validator
        bytes memory ret = smartAccount.execute(
            STAKING_PRECOMPILE_ADDRESS,
            0,
            abi.encodeWithSelector(
                StakingI.undelegate.selector,
                address(smartAccount),
                params.validatorAddress,
                params.amount
            )
        );
        int64 completionTime = abi.decode(ret, (int64));

        emit Undelegated(
            tacHeader.tvmCaller,
            params.validatorAddress,
            params.amount,
            completionTime
        );
    }

    /// @dev RedelegateParams struct to hold the parameters for redelegation
    /// @param oldValidatorAddress The address of the validator to undelegate from
    /// @param newValidatorAddress The address of the validator to delegate to
    /// @param amount The amount to redelegate
    struct RedelegateParams {
        string oldValidatorAddress; // The address of the validator to undelegate from
        string newValidatorAddress; // The address of the validator to delegate to
        uint256 amount; // The amount to redelegate
    }

    /// @dev Function to redelegate tokens from one validator to another
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded RedelegateParams struct.
    function redelegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        RedelegateParams memory params = abi.decode(_params, (RedelegateParams));

        // Get or create the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Redelegate the tokens from one validator to another
        bytes memory ret = smartAccount.execute(
            STAKING_PRECOMPILE_ADDRESS,
            0,
            abi.encodeWithSelector(
                StakingI.redelegate.selector,
                address(smartAccount),
                params.oldValidatorAddress,
                params.newValidatorAddress,
                params.amount
            )
        );
        int64 completionTime = abi.decode(ret, (int64));

        emit Redelegated(
            tacHeader.tvmCaller,
            params.oldValidatorAddress,
            params.newValidatorAddress,
            params.amount,
            completionTime
        );
    }

    /// @dev WithdrawDelegatorRewardsParams struct to hold the parameters for withdrawing rewards
    /// @param validatorAddress The address of the validator from which to withdraw rewards
    struct WithdrawDelegatorRewardsParams {
        string validatorAddress; // The address of the validator from which to withdraw rewards
    }

    /// @dev Function to withdraw rewards from a validator
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded WithdrawDelegatorRewardsParams struct.
    function withdrawDelegatorRewards(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        WithdrawDelegatorRewardsParams memory params = abi.decode(
            _params,
            (WithdrawDelegatorRewardsParams)
        );

        // Get or create the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Withdraw rewards from the validator
        bytes memory ret = smartAccount.execute(
            DISTRIBUTION_PRECOMPILE_ADDRESS,
            0,
            abi.encodeWithSelector(
                DistributionI.withdrawDelegatorRewards.selector,
                address(smartAccount),
                params.validatorAddress
            )
        );

        Coin[] memory rewards = abi.decode(ret, (Coin[]));

        require(rewards.length > 0, "StakingProxy: No rewards to withdraw");
        require(rewards[0].amount > 0, "StakingProxy: No rewards to withdraw");

        // withdraw the rewards to the Smart Account
        smartAccount.execute(
            address(this),
            rewards[0].amount, // send TAC to this contract
            ""
        );

        // Bridge the rewards to the TVM
        _bridgeToTon(tacHeader, rewards[0].amount);

        emit WithdrawnDelegatorRewards(
            tacHeader.tvmCaller,
            params.validatorAddress,
            rewards[0].amount
        );
    }

    /// @dev Function to withdraw all available tokens from the Smart Account
    /// @param _tacHeader The TAC header.
    /// @param {} empty params
    function withdrawFromAccount(
        bytes calldata _tacHeader,
        bytes calldata
    ) external _onlyCrossChainLayer {
        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);

        // Get the Smart Account for the user
        (address sa,) = saFactory.getOrCreateSmartAccount(tacHeader.tvmCaller);
        ITacSmartAccount smartAccount = ITacSmartAccount(sa);

        // Withdraw all tokens from the Smart Account
        uint256 balance = address(smartAccount).balance;
        require(balance > 0, "StakingProxy: No balance to withdraw");

        // Execute the withdrawal from the Smart Account
        smartAccount.execute(
            address(this),
            balance, // send all TAC to this contract
            "" // no payload
        );

        // Bridge the balance to the TVM
        _bridgeToTon(tacHeader, balance);
    }

}
