// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

contract StakingMock {

    uint64 public constant COMPLETION_TIMEOUT = 1 hours;

    struct Delegation {
        uint64 delegationTime;
        uint256 amount;
    }

    struct Undelegation {
        uint256 amount;
        int64 completionTime;
    }

    mapping(address => mapping(string => Delegation)) public delegations;
    mapping(address => mapping(uint64 => Undelegation)) public undelegations;

    function getDelegation(
        address delegatorAddress,
        string memory validatorAddress
    ) external view returns (Delegation memory delegation) {
        return delegations[delegatorAddress][validatorAddress];
    }

    function getUndelegation(
        address delegatorAddress,
        uint64 undelegationTime
    ) external view returns (Undelegation memory undelegation) {
        return undelegations[delegatorAddress][undelegationTime];
    }

    /// @dev Defines a method for performing a delegation of coins from a delegator to a validator.
    /// @param delegatorAddress The address of the delegator
    /// @param validatorAddress The address of the validator
    /// @param amount The amount of the bond denomination to be delegated to the validator.
    /// This amount should use the bond denomination precision stored in the bank metadata.
    /// @return success Whether or not the delegate was successful
    function delegate(
        address delegatorAddress,
        string memory validatorAddress,
        uint256 amount
    ) external payable returns (bool success) {
        require(amount > 0, "Amount must be greater than zero");
        require(msg.value == amount, "Incorrect amount sent");

        Delegation storage delegation = delegations[delegatorAddress][validatorAddress];
        delegation.delegationTime = uint64(block.timestamp);
        delegation.amount += amount;

        success = true;
    }

    /// @dev Defines a method for performing an undelegation from a delegate and a validator.
    /// @param delegatorAddress The address of the delegator
    /// @param validatorAddress The address of the validator
    /// @param amount The amount of the bond denomination to be undelegated from the validator.
    /// This amount should use the bond denomination precision stored in the bank metadata.
    /// @return completionTime The time when the undelegation is completed
    function undelegate(
        address delegatorAddress,
        string memory validatorAddress,
        uint256 amount
    ) external returns (int64 completionTime) {
        require(amount > 0, "Amount must be greater than zero");
        Delegation storage delegation = delegations[delegatorAddress][validatorAddress];
        require(delegation.amount >= amount, "Insufficient delegation amount");
        delegation.amount -= amount;
        Undelegation storage undelegation = undelegations[delegatorAddress][uint64(block.timestamp)];
        undelegation.amount += amount;
        completionTime = int64(uint64(block.timestamp) + COMPLETION_TIMEOUT);
        undelegation.completionTime = completionTime;
    }

    function sendUndelegated(
        address delegatorAddress,
        uint64 undelegationTime
    ) external {
        Undelegation storage undelegation = undelegations[delegatorAddress][undelegationTime];
        require(undelegation.completionTime <= int64(uint64(block.timestamp)), "Undelegation not completed yet");
        require(undelegation.amount > 0, "No undelegated amount");

        uint256 amount = undelegation.amount;
        undelegation.amount = 0;

        // Simulate sending the undelegated amount back to the delegator
        (bool success, ) = delegatorAddress.call{ value: amount }("");
        require(success, "Failed to send undelegated funds");
    }
}