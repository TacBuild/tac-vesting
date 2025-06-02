// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { StakingAccount } from "./StakingAccount.sol";

/// @title TacVesting
/// @author TACBuild Team
contract TacVesting is UUPSUpgradeable, Ownable2StepUpgradeable, ReentrancyGuardUpgradeable {

    // === EVENTS ===

    event Delegated(
        address user,
        string validatorAddress,
        uint256 amount
    );

    event Undelegated(
        address user,
        string validatorAddress,
        int64 completionTime
    );

    event WithdrawnUndelegatedTokens(
        address user,
        uint256 amount
    );

    event Withdrawn(
        address user,
        string validatorAddress,
        uint256 amount
    );

    event RewardsClaimed(
        address user,
        string validatorAddress
    );

    // === CONSTANTS ===

    uint256 public constant BASIS_POINTS = 10_000; // 100 % = 10 000 bps
    uint256 public constant IMMEDIATE_PCT = 3_000; // immediate rewards withdrawal percentage (30 % = 3 000 bps)
    uint256 public constant VESTING_STEPS = 3; // number of vesting steps (3 steps = 3 months)


    // === STATE VARIABLES ===
    uint256 public stepDuration; // Duration of each vesting step in seconds
    bytes32 public merkleRoot;

    struct UserInfo {
        uint40         choiceStartTime; // The time when the user made their choice
        uint8          stepMask; // Bitmask representing the tranches steps
        StakingAccount stakingAccount; // User's staking account
        uint256        userTotalRewards; // Total rewards the user is entitled to
        uint256        availableRewards; // Total rewards available for the user to withdraw or undelegate
        uint256        withdrawn; // Total rewards the user has withdrawn
    }

    mapping(address => UserInfo) public info;

    // TODO: remove from state and move to const variables
    address public stakingContract;
    address public distributionContract;

    // === END OF STATE VARIABLES ===

    /**
     * @dev Initializer function to initialize the contract with initial state.
     * @param _adminAddress admin address.
     * @param _stepDuration The duration of each vesting step in days.
     */
    function initialize(
        address _adminAddress,
        address _stakingContract,
        address _distributionContract,
        uint256 _stepDuration
    ) public initializer virtual { // TODO: remove virtual modifier
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

    /// @dev Emergency withdraw function
    /// @param to The address to withdraw the funds to.
    function emergencyWithdraw(
        address payable to,
        uint256 amount
    ) external onlyOwner {
        require(to != address(0), "TacVesting: Cannot withdraw to zero address");
        require(address(this).balance >= amount, "TacVesting: Insufficient balance to withdraw");

        (bool success, ) = to.call{ value: amount }("");
        require(success, "TacVesting: Emergency withdraw failed");
    }

    //================================================================
    // INTERNAL FUNCTIONS
    //================================================================

    /// @dev Function to calculate the double keccak256 hash of user address and total rewards
    /// @param user The address of the user.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @return The double keccak256 hash of user address and total rewards.
    function doubleKeccak256(
        address user,
        uint256 userTotalRewards
    ) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encodePacked(user, userTotalRewards))));
    }

    /// @dev Function to check the merkle proof for the user
    /// @param user The address of the user.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    function checkProof(
        address user,
        uint256 userTotalRewards,
        bytes32[] calldata merkleProof
    ) internal view {
        require(merkleRoot != bytes32(0), "TacVesting: Merkle root not set");
        require(
            MerkleProof.verify(merkleProof, merkleRoot, doubleKeccak256(user, userTotalRewards)),
            "TacVesting: Invalid merkle proof"
        );
    }

    /// @dev Check if the user has made a choice
    /// @param userInfo The UserInfo struct of the user.
    function checkChoiceTime(
        UserInfo storage userInfo
    ) internal view {
        require(userInfo.choiceStartTime != 0, "TacVesting: User has not made a choice");
    }

    /// @dev Check if the user has chosen staking
    /// @param userInfo The UserInfo struct of the user.
    function checkStaking(
        UserInfo storage userInfo
    ) internal view {
        checkChoiceTime(userInfo);
        require(address(userInfo.stakingAccount) != address(0), "TacVesting: User has not chosen staking");
    }

    /// @dev Check if the user has chosen immediate withdraw
    /// @param userInfo The UserInfo struct of the user.
    function checkImmediateChoice(
        UserInfo storage userInfo
    ) internal view {
        checkChoiceTime(userInfo);
        require(address(userInfo.stakingAccount) == address(0), "TacVesting: User has not chosen immediate withdraw");
    }

    /// @dev Recalculate available rewards for the user
    /// @param userInfo The UserInfo struct of the user.
    function recalcAvailableRewards(
        UserInfo storage userInfo
    ) internal {
        for (uint8 step = 0; step < VESTING_STEPS; step++) {
            if ((userInfo.stepMask & (uint8(1) << step)) == 0) {
                uint256 stepStartTime = userInfo.choiceStartTime + (step * stepDuration);
                if (block.timestamp >= stepStartTime) {

                    if (step == VESTING_STEPS - 1) {
                        // unlock all remaining rewards on the last step
                        userInfo.availableRewards = userInfo.userTotalRewards;
                    } else {
                        uint256 stepRewards;
                        if (address(userInfo.stakingAccount) != address(0)) {
                            // if user choosen staking - he can undelegate 1/3 of total rewards every step
                            stepRewards = userInfo.userTotalRewards / VESTING_STEPS;

                        } else {
                            // if user choosen immediate withdraw - he can withdraw (total - immediate) / STEPS every step
                            stepRewards = (userInfo.userTotalRewards * (BASIS_POINTS - IMMEDIATE_PCT)) / (VESTING_STEPS * BASIS_POINTS);
                        }
                        userInfo.availableRewards += stepRewards;
                    }

                    userInfo.stepMask |= (uint8(1) << step); // Mark this step as completed
                }
            }
        }
    }

    //================================================================
    // USER's FUNCTIONS
    //================================================================

    // == STAKING ==

    /// @dev Choose staking
    /// @param validatorAddress The address of the validator to delegate to.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    function chooseStaking(
        string memory validatorAddress,
        uint256 userTotalRewards,
        bytes32[] calldata merkleProof
    ) external virtual { // TODO: remove virtual modifier
        checkProof(msg.sender, userTotalRewards, merkleProof);

        UserInfo storage userInfo = info[msg.sender];
        require(userInfo.choiceStartTime == 0, "TacVesting: User has already made a choice");
        userInfo.choiceStartTime = uint40(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.stakingAccount = new StakingAccount(stakingContract, distributionContract);
        if (address(userInfo.stakingAccount) == address(0)) {
            revert("TacVesting: Failed to create StakingAccount");
        }
        // Delegate the tokens to the validator
        userInfo.stakingAccount.delegate{value: userTotalRewards}(validatorAddress);
    }

    /// @dev Undelegate available rewards
    /// @param validatorAddress The address of the validator to undelegate from.
    /// @param amount The amount of rewards to undelegate.
    function undelegate(
        string memory validatorAddress,
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);

        recalcAvailableRewards(userInfo);
        require(
            (userInfo.availableRewards - userInfo.withdrawn) >= amount,
            "TacVesting: No available rewards to undelegate");

        // Undelegate the tokens from the validator
        int64 completionTime = userInfo.stakingAccount.undelegate(validatorAddress, amount);
        userInfo.withdrawn += amount;

        emit Undelegated(msg.sender, validatorAddress, completionTime);
    }

    /// @dev Claim delegator rewards
    /// @param validatorAddress The address of the validator to claim rewards from.
    function claimDelegatorRewards(
        string memory validatorAddress
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);

        // user can claim rewards only after the first step is completed
        if (userInfo.choiceStartTime + stepDuration >= block.timestamp) {
            revert("TacVesting: Cannot claim rewards before the first step is completed");
        }

        // Withdraw the rewards from the validator
        userInfo.stakingAccount.withdrawRewards(payable(msg.sender), validatorAddress);

        emit RewardsClaimed(msg.sender, validatorAddress);
    }

    /// @dev Withdraw undelegated tokens. Token withdrawal is possible only after the undelegation period is over.
    /// Undelegated tokens just stored on staking account and can be withdrawn at any time.
    /// @param amount The amount of undelegated tokens to withdraw.
    function withdrawUndelegatedTokens(
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);
        // Withdraw the undelegated tokens
        userInfo.stakingAccount.withdrawUndelegatedTokens(payable(msg.sender), amount);

        emit Withdrawn(msg.sender, "", amount);
    }

    // == IMMEDIATE WITHDRAW ==

    /// @dev Choose immediate withdraw
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    function chooseImmediateWithdraw(
        uint256 userTotalRewards,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        checkProof(msg.sender, userTotalRewards, merkleProof);

        UserInfo storage userInfo = info[msg.sender];
        require(userInfo.choiceStartTime == 0, "TacVesting: User has already made a choice");
        userInfo.choiceStartTime = uint40(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.availableRewards = (userTotalRewards * (BASIS_POINTS - IMMEDIATE_PCT)) / BASIS_POINTS;
        userInfo.withdrawn = userInfo.availableRewards;

        // send immediate rewards to user
        (bool success, ) = address(msg.sender).call{ value: userInfo.availableRewards }("");
        require(success, "TacVesting: Immediate withdraw failed");
    }

    /// @dev Withdraw available rewards
    /// @param amount The amount of rewards to withdraw.
    function withdrawAvailableRewards(
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkImmediateChoice(userInfo);

        recalcAvailableRewards(userInfo);
        require(
            (userInfo.availableRewards - userInfo.withdrawn) >= amount,
            "TacVesting: No available rewards to withdraw");

        // send available rewards to user
        (bool success, ) = address(msg.sender).call{ value: amount }("");
        require(success, "TacVesting: Withdraw failed");
        userInfo.withdrawn += amount;

        emit Withdrawn(msg.sender, "", amount);
    }

}