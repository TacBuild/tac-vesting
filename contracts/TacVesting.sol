// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

import { TacHeaderV1, OutMessageV1, TokenAmount, NFTAmount } from "@tonappchain/evm-ccl/contracts/core/Structs.sol";
import { TacProxyV1Upgradeable } from "@tonappchain/evm-ccl/contracts/proxies/TacProxyV1Upgradeable.sol";

import { StakingAccount } from "./StakingAccount.sol";

/// @title TacVesting
/// @author TACBuild Team
contract TacVesting is UUPSUpgradeable, TacProxyV1Upgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {

    // === EVENTS ===

    event Delegated(
        string userTVMAddress,
        string validatorAddress,
        uint256 amount
    );

    event Undelegated(
        string userTVMAddress,
        uint256 amount,
        int64 completionTime
    );

    event WithdrawnFromAccount(
        string userTVMAddress,
        uint256 amount
    );

    event Withdrawn(
        string userTVMAddress,
        uint256 amount
    );

    event RewardsClaimed(
        string userTVMAddress,
        uint256 rewardAmount
    );

    // === CONSTANTS ===

    uint256 public constant BASIS_POINTS = 10_000; // 100 % = 10 000 bps
    uint256 public constant IMMEDIATE_PCT = 3_000; // immediate rewards withdrawal percentage (30 % = 3 000 bps)
    uint256 public constant VESTING_STEPS = 3; // number of vesting steps (3 steps = 3 months)

    // === STATE VARIABLES ===
    uint256 public stepDuration; // Duration of each vesting step in seconds
    bytes32 public merkleRoot;

    struct UserInfo {
        uint64         choiceStartTime; // The time when the user made their choice
        StakingAccount stakingAccount; // User's staking account
        uint256        userTotalRewards; // Total rewards the user is entitled to
        uint256        unlocked; // Total rewards which are unlocked and can be withdrawn or undelegated
        uint256        withdrawn; // Total rewards the user has already withdrawn or undelegated
    }

    mapping(string => UserInfo) public info;

    // === END OF STATE VARIABLES ===

    /**
     * @dev Initializer function to initialize the contract with initial state.
     * @param crossChainLayer The address of the cross chain layer contract.
     * @param _adminAddress admin address.
     * @param _stepDuration The duration of each vesting step in days.
     */
    function initialize(
        address crossChainLayer,
        address _adminAddress,
        uint256 _stepDuration
    ) public initializer virtual { // TODO: remove virtual modifier
        require(_adminAddress != address(0), "TacVesting: Admin address cannot be zero");
        __UUPSUpgradeable_init();
        __TacProxyV1Upgradeable_init(crossChainLayer);
        __Ownable_init(_adminAddress);
        __ReentrancyGuard_init();

        stepDuration = _stepDuration;
    }

    function _authorizeUpgrade(address) internal override onlyOwner {}

    receive() external payable {}

    //================================================================
    // ADMIN FUNCTIONS
    //================================================================

    /// @dev setup merkle root
    /// @param _merkleRoot The merkle root to set.
    function setMerkleRoot(
        bytes32 _merkleRoot
    ) external onlyOwner {
        require(_merkleRoot != bytes32(0), "TacVesting: Merkle root cannot be zero");
        merkleRoot = _merkleRoot;
    }

    //================================================================
    // INTERNAL FUNCTIONS
    //================================================================

    /// @dev Function to calculate the hash of the leaf node in the Merkle tree
    /// @param userTVMAddress The tvm address of the user.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @return The double keccak256 hash of user address and total rewards.
    function _createLeaf(
        string memory userTVMAddress,
        uint256 userTotalRewards
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(userTVMAddress, userTotalRewards));
    }

    /// @dev Function to check the merkle proof for the user
    /// @param userTVMAddress The tvm address of the user.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    function _checkProof(
        string memory userTVMAddress,
        uint256 userTotalRewards,
        bytes32[] memory merkleProof
    ) internal view {
        require(merkleRoot != bytes32(0), "TacVesting: Merkle root not set");
        require(
            MerkleProof.verify(merkleProof, merkleRoot, _createLeaf(userTVMAddress, userTotalRewards)),
            "TacVesting: Invalid merkle proof"
        );
    }

    /// @dev Check if the user has made a choice
    /// @param userInfo The UserInfo struct of the user.
    function _checkNoChoice(
        UserInfo storage userInfo
    ) internal view {
        require(userInfo.choiceStartTime == 0, "TacVesting: User already made a choice");
    }

    /// @dev Check if the user has made a choice
    /// @param userInfo The UserInfo struct of the user.
    function _checkChoiceTime(
        UserInfo storage userInfo
    ) internal view {
        require(userInfo.choiceStartTime != 0, "TacVesting: User has not made a choice");
    }

    /// @dev Check if the user has chosen staking
    /// @param userInfo The UserInfo struct of the user.
    function _checkStaking(
        UserInfo storage userInfo
    ) internal view {
        _checkChoiceTime(userInfo);
        require(address(userInfo.stakingAccount) != address(0), "TacVesting: User has not chosen staking");
    }

    /// @dev Check if the user has chosen immediate withdraw
    /// @param userInfo The UserInfo struct of the user.
    function _checkImmediateChoice(
        UserInfo storage userInfo
    ) internal view {
        _checkChoiceTime(userInfo);
        require(address(userInfo.stakingAccount) == address(0), "TacVesting: User has not chosen immediate withdraw");
    }

    /// @dev Calculate user's unlocked rewards.
    /// @param userInfo The user info struct.
    /// @return unlocked The amount of unlocked rewards for the user.
    function _calculateUnlocked(
        UserInfo memory userInfo
    ) internal view returns (uint256 unlocked) {
        if (userInfo.choiceStartTime == 0) {
            return 0; // User has not made a choice yet
        }

        uint256 afterChoiceTime = block.timestamp - userInfo.choiceStartTime;
        uint256 stepsCompleted = afterChoiceTime / stepDuration > VESTING_STEPS ? VESTING_STEPS : afterChoiceTime / stepDuration;
        if (stepsCompleted == VESTING_STEPS) {
            unlocked = userInfo.userTotalRewards; // All rewards are unlocked after the last step
        } else {
            if (address(userInfo.stakingAccount) != address(0)) { // if user choosen staking
                unlocked = (userInfo.userTotalRewards * stepsCompleted) / VESTING_STEPS;
            } else { // if user choosen immediate withdraw
                uint256 firstTransfer = (userInfo.userTotalRewards * IMMEDIATE_PCT) / BASIS_POINTS;
                uint256 stepRewards = (userInfo.userTotalRewards - firstTransfer) / VESTING_STEPS;
                unlocked = firstTransfer + (stepRewards * stepsCompleted);
            }
        }
    }

    /// @dev Update unlocked rewards for the user
    /// @param userInfo The UserInfo struct of the user.
    function _updateUnlocked(
        UserInfo storage userInfo
    ) internal {
        userInfo.unlocked = _calculateUnlocked(userInfo);
    }

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

    // == STAKING ==

    /// @dev Choose staking params
    /// @param validatorAddress The address of the validator to delegate to.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    struct ChooseStakingParams {
        string validatorAddress; // The address of the validator to delegate to.
        uint256 userTotalRewards; // The total rewards the user is entitled to.
        bytes32[] merkleProof; // The merkle proof to verify the user's entitlement.
    }

    /// @dev Function to create delegation instead immediate withdraw.
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded ChooseStakingParams struct.
    function chooseStaking(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external virtual _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        ChooseStakingParams memory params = abi.decode(_params, (ChooseStakingParams));

        _checkProof(tacHeader.tvmCaller, params.userTotalRewards, params.merkleProof);

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = params.userTotalRewards;
        userInfo.stakingAccount = StakingAccount(payable(Create2.deploy(
            0,
            keccak256(abi.encode(tacHeader.tvmCaller)),
            type(StakingAccount).creationCode
        )));
        require(address(userInfo.stakingAccount) != address(0), "TacVesting: Failed to create StakingAccount");

        // Delegate the tokens to the validator
        bool success = userInfo.stakingAccount.delegate{value: params.userTotalRewards}(params.validatorAddress);
        require(success, "TacVesting: Failed to delegate tokens");

        emit Delegated(tacHeader.tvmCaller, params.validatorAddress, params.userTotalRewards);
    }

    /// @dev Undelegate available tokens from the validator
    /// @param _tacHeader The TAC header
    /// @param _params The encoded uint256 amount to undelegate.
    function undelegate(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        uint256 amount = abi.decode(_params, (uint256));

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkStaking(userInfo);

        _updateUnlocked(userInfo);
        require(
            (userInfo.unlocked - userInfo.withdrawn) >= amount,
            "TacVesting: No available funds to undelegate");

        // Undelegate the tokens from the validator
        int64 completionTime = userInfo.stakingAccount.undelegate(amount);

        // update user's withdrawn amount
        userInfo.withdrawn += amount;

        emit Undelegated(tacHeader.tvmCaller, amount, completionTime);
    }

    /// @dev Claim delegator rewards
    /// @param _tacHeader The TAC header
    /// @param {} Empty bytes, no additional parameters are needed for this function.
    function claimDelegatorRewards(
        bytes calldata _tacHeader,
        bytes calldata
    ) external _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkStaking(userInfo);

        // user can claim rewards only after the first step is completed
        if (userInfo.choiceStartTime + stepDuration > block.timestamp) {
            revert("TacVesting: Cannot claim rewards before the first step is completed");
        }

        // Withdraw the rewards from the validator
        uint256 rewardsAmount = userInfo.stakingAccount.withdrawRewards();

        // send rewards to TON user
        _bridgeToTon(tacHeader, rewardsAmount);

        emit RewardsClaimed(tacHeader.tvmCaller, rewardsAmount);
    }

    /// @dev Withdraw tokens from staking account. It's used to withdraw undelegated tokens and rewards.
    /// After undelegation is completed, staking account receives undelegated tokens and rewards.
    /// Undelegation and rewards just stored on staking account and can be withdrawn at any time.
    /// @param _tacHeader The TAC header
    /// @param {} The empty bytes, no additional params are needed for this function.
    function withdrawFromAccount(
        bytes calldata _tacHeader,
        bytes calldata
    ) external _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkStaking(userInfo);
        // Withdraw from staking account
        uint256 amount = userInfo.stakingAccount.withdraw();
        // send tokens to TON user
        if (amount > 0) _bridgeToTon(tacHeader, amount);

        emit WithdrawnFromAccount(tacHeader.tvmCaller, amount);
    }

    // == IMMEDIATE WITHDRAW ==

    /// @dev Choose immediate withdraw params
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    struct ChooseImmediateWithdrawParams {
        uint256 userTotalRewards; // The total rewards the user is entitled to.
        bytes32[] merkleProof; // The merkle proof to verify the user's entitlement.
    }

    /// @dev Function to choose immediate withdraw instead staking.
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded ChooseImmediateWithdrawParams struct.
    function chooseImmediateWithdraw(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        ChooseImmediateWithdrawParams memory params = abi.decode(_params, (ChooseImmediateWithdrawParams));

        _checkProof(tacHeader.tvmCaller, params.userTotalRewards, params.merkleProof);

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = params.userTotalRewards;
        userInfo.unlocked = (params.userTotalRewards * IMMEDIATE_PCT) / BASIS_POINTS;
        userInfo.withdrawn = userInfo.unlocked;

        // send immediate rewards to TON user
        _bridgeToTon(tacHeader, userInfo.unlocked);

        emit Withdrawn(tacHeader.tvmCaller, userInfo.unlocked);
    }

    /// @dev Withdraw available funds
    /// @param _tacHeader The TAC header.
    /// @param _params The encoded uint256 amount to withdraw.
    function withdraw(
        bytes calldata _tacHeader,
        bytes calldata _params
    ) external _onlyCrossChainLayer {

        TacHeaderV1 memory tacHeader = _decodeTacHeader(_tacHeader);
        uint256 amount = abi.decode(_params, (uint256));

        UserInfo storage userInfo = info[tacHeader.tvmCaller];
        _checkImmediateChoice(userInfo);
        _updateUnlocked(userInfo);
        require(
            (userInfo.unlocked - userInfo.withdrawn) >= amount,
            "TacVesting: No available funds to withdraw");

        // send rewards to user
        _bridgeToTon(tacHeader, amount);

        // Update user's withdrawn amount
        userInfo.withdrawn += amount;

        emit Withdrawn(tacHeader.tvmCaller, amount);
    }


    //================================================================
    // VIEW FUNCTIONS
    //================================================================

    /// @dev Get user's available rewards
    /// @param userTVMAddress The TVM address of the user.
    /// @return unlocked The amount of unlocked rewards which can be withdrawn or undelegated.
    function getUnlocked(
        string calldata userTVMAddress
    ) external view returns (uint256) {
        UserInfo memory userInfo = info[userTVMAddress];
        return _calculateUnlocked(userInfo);
    }

    /// @dev Get user's available rewards which can be withdrawn or undelegated
    /// @param userTVMAddress The address of the user.
    /// @return available The amount of available rewards which can be withdrawn or undelegated.
    function getAvailable(
        string calldata userTVMAddress
    ) external view returns (uint256) {
        UserInfo memory userInfo = info[userTVMAddress];
        return _calculateUnlocked(userInfo) - userInfo.withdrawn;
    }
}