// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

import { Ownable2StepUpgradeable } from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { MerkleProof } from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import { ReentrancyGuardUpgradeable } from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";

import { Create2 } from "@openzeppelin/contracts/utils/Create2.sol";

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
        uint256 amount,
        int64 completionTime
    );

    event WithdrawnUndelegated(
        address user,
        address to,
        uint256 amount
    );

    event Withdrawn(
        address user,
        address to,
        uint256 amount
    );

    event RewardsClaimed(
        address user,
        address to,
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
        uint64         choiceStartTime; // The time when the user made their choice
        StakingAccount stakingAccount; // User's staking account
        uint256        userTotalRewards; // Total rewards the user is entitled to
        uint256        unlocked; // Total rewards which are unlocked and can be withdrawn or undelegated
        uint256        withdrawn; // Total rewards the user has already withdrawn or undelegated
    }

    mapping(address => UserInfo) public info;

    // === END OF STATE VARIABLES ===

    /**
     * @dev Initializer function to initialize the contract with initial state.
     * @param _adminAddress admin address.
     * @param _stepDuration The duration of each vesting step in days.
     */
    function initialize(
        address _adminAddress,
        uint256 _stepDuration
    ) public initializer virtual { // TODO: remove virtual modifier
        require(_adminAddress != address(0), "TacVesting: Admin address cannot be zero");
        __UUPSUpgradeable_init();
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
        return keccak256(bytes.concat(keccak256(abi.encode(user, userTotalRewards))));
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
    function checkNoChoice(
        UserInfo storage userInfo
    ) internal view {
        require(userInfo.choiceStartTime == 0, "TacVesting: User already made a choice");
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

    /// @dev Calculate user's unlocked rewards.
    /// @param userInfo The user info struct.
    /// @return unlocked The amount of unlocked rewards for the user.
    function calculateUnlocked(
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
    function updateUnlocked(
        UserInfo storage userInfo
    ) internal {
        userInfo.unlocked = calculateUnlocked(userInfo);
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
        checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.stakingAccount = StakingAccount(payable(Create2.deploy(
            0,
            keccak256(abi.encode(msg.sender)),
            type(StakingAccount).creationCode
        )));
        if (address(userInfo.stakingAccount) == address(0)) {
            revert("TacVesting: Failed to create StakingAccount");
        }
        // Delegate the tokens to the validator
        userInfo.stakingAccount.delegate{value: userTotalRewards}(validatorAddress);

        emit Delegated(msg.sender, validatorAddress, userTotalRewards);
    }

    /// @dev Undelegate available stake
    /// @param validatorAddress The address of the validator to undelegate from.
    /// @param amount The amount to undelegate.
    function undelegate(
        string memory validatorAddress,
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);

        updateUnlocked(userInfo);
        require(
            (userInfo.unlocked - userInfo.withdrawn) >= amount,
            "TacVesting: No available funds to undelegate");

        // Undelegate the tokens from the validator
        int64 completionTime = userInfo.stakingAccount.undelegate(validatorAddress, amount);
        userInfo.withdrawn += amount;

        emit Undelegated(msg.sender, validatorAddress, amount, completionTime);
    }

    /// @dev Claim delegator rewards
    /// @param to The address to send the rewards to.
    /// @param validatorAddress The address of the validator to claim rewards from.
    function claimDelegatorRewards(
        address to,
        string memory validatorAddress
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);
        require(to != address(0), "TacVesting: Cannot withdraw to zero address");

        // user can claim rewards only after the first step is completed
        if (userInfo.choiceStartTime + stepDuration > block.timestamp) {
            revert("TacVesting: Cannot claim rewards before the first step is completed");
        }

        // Withdraw the rewards from the validator
        userInfo.stakingAccount.withdrawRewards(payable(msg.sender), validatorAddress);

        emit RewardsClaimed(msg.sender, to, validatorAddress);
    }

    /// @dev Withdraw undelegated tokens. Token withdrawal is possible only after the undelegation period is over.
    /// Undelegated tokens just stored on staking account and can be withdrawn at any time.
    /// @param to The address to withdraw the undelegated tokens to.
    /// @param amount The amount to withdraw.
    function withdrawUndelegated(
        address to,
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkStaking(userInfo);
        require(to != address(0), "TacVesting: Cannot withdraw to zero address");
        // Withdraw the undelegated tokens
        userInfo.stakingAccount.withdrawUndelegatedTokens(to, amount);

        emit WithdrawnUndelegated(msg.sender, to, amount);
    }

    // == IMMEDIATE WITHDRAW ==

    /// @dev Choose immediate withdraw
    /// @param to The address to send the immediate rewards to.
    /// @param userTotalRewards The total rewards the user is entitled to.
    /// @param merkleProof The merkle proof to verify the user's entitlement.
    function chooseImmediateWithdraw(
        address to,
        uint256 userTotalRewards,
        bytes32[] calldata merkleProof
    ) external nonReentrant {
        checkProof(msg.sender, userTotalRewards, merkleProof);

        require(to != address(0), "TacVesting: Cannot withdraw to zero address");

        UserInfo storage userInfo = info[msg.sender];
        checkNoChoice(userInfo);
        userInfo.choiceStartTime = uint64(block.timestamp);
        userInfo.userTotalRewards = userTotalRewards;
        userInfo.unlocked = (userTotalRewards * IMMEDIATE_PCT) / BASIS_POINTS;
        userInfo.withdrawn = userInfo.unlocked;

        // send immediate rewards to user
        (bool success, ) = to.call{ value: userInfo.unlocked }("");
        require(success, "TacVesting: Immediate withdraw failed");

        emit Withdrawn(msg.sender, to, userInfo.unlocked);
    }

    /// @dev Withdraw available funds
    /// @param amount The amount to withdraw.
    function withdraw(
        address to,
        uint256 amount
    ) external nonReentrant {
        UserInfo storage userInfo = info[msg.sender];
        checkImmediateChoice(userInfo);
        updateUnlocked(userInfo);
        require(
            (userInfo.unlocked - userInfo.withdrawn) >= amount,
            "TacVesting: No available funds to withdraw");

        // send rewards to user
        (bool success, ) = address(to).call{ value: amount }("");
        require(success, "TacVesting: Withdraw failed");
        userInfo.withdrawn += amount;

        emit Withdrawn(msg.sender, to, amount);
    }


    //================================================================
    // VIEW FUNCTIONS
    //================================================================

    /// @dev Get user's available rewards
    /// @param user The address of the user.
    /// @return unlocked The amount of unlocked rewards which can be withdrawn or undelegated.
    function getUnlocked(
        address user
    ) external view returns (uint256) {
        UserInfo memory userInfo = info[user];
        return calculateUnlocked(userInfo);
    }

    /// @dev Get user's available rewards which can be withdrawn or undelegated
    /// @param user The address of the user.
    /// @return available The amount of available rewards which can be withdrawn or undelegated.
    function getAvailable(
        address user
    ) external view returns (uint256) {
        UserInfo memory userInfo = info[user];
        return calculateUnlocked(userInfo) - userInfo.withdrawn;
    }
}