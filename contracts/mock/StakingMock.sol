// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

/// @dev Coin is a struct that represents a token with a denomination and an amount.
struct Coin {
    string denom;
    uint256 amount;
}

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

    struct Redelegation {
        string validatorAddressFrom;
        string validatorAddressTo;
        uint256 amount;
        int64 completionTime;
    }

    mapping(address => mapping(string => Delegation)) public delegations;
    mapping(address => mapping(uint64 => Undelegation)) public undelegations;
    mapping(address => mapping(uint64 => Redelegation)) public redelegations;

    function getDelegation(
        address delegatorAddress,
        string memory validatorAddress
    ) external view returns (Delegation memory) {
        return delegations[delegatorAddress][validatorAddress];
    }

    function getUndelegation(
        address delegatorAddress,
        uint64 undelegationTime
    ) external view returns (Undelegation memory undelegation) {
        return undelegations[delegatorAddress][undelegationTime];
    }

    function getRedelegation(
        address delegatorAddress,
        uint64 redelegationTime
    ) external view returns (Redelegation memory redelegation) {
        return redelegations[delegatorAddress][redelegationTime];
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

        Delegation storage _delegation = delegations[delegatorAddress][validatorAddress];
        _delegation.amount += amount;
        _delegation.delegationTime = uint64(block.timestamp);

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
        Delegation storage _delegation = delegations[delegatorAddress][validatorAddress];
        require(_delegation.amount >= amount, "Insufficient delegation amount");
        _delegation.amount -= amount;
        Undelegation storage undelegation = undelegations[delegatorAddress][uint64(block.timestamp)];
        undelegation.amount += amount;
        completionTime = int64(uint64(block.timestamp) + COMPLETION_TIMEOUT);
        undelegation.completionTime = completionTime;
    }

    // redelegate
    /// @dev Defines a method for performing a redelegation from a delegate and a validator to another validator.
    /// @param delegatorAddress The address of the delegator
    /// @param fromValidatorAddress The address of the validator to undelegate from
    /// @param toValidatorAddress The address of the validator to delegate to
    /// @param amount The amount of the bond denomination to be redelegated.
    /// This amount should use the bond denomination precision stored in the bank metadata.
    /// @return completionTime The time when the redelegation is completed
    function redelegate(
        address delegatorAddress,
        string memory fromValidatorAddress,
        string memory toValidatorAddress,
        uint256 amount
    ) external returns (int64 completionTime) {
        require(amount > 0, "Amount must be greater than zero");

        Delegation storage fromDelegation = delegations[delegatorAddress][fromValidatorAddress];
        require(fromDelegation.amount >= amount, "Insufficient delegation amount from the source validator");

        Redelegation storage redelegation = redelegations[delegatorAddress][uint64(block.timestamp)];

        redelegation.validatorAddressFrom = fromValidatorAddress;
        redelegation.validatorAddressTo = toValidatorAddress;
        redelegation.amount += amount;

        completionTime = int64(uint64(block.timestamp) + COMPLETION_TIMEOUT);
        redelegation.completionTime = completionTime;

        return completionTime;
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

    function sendRedelegated(
        address delegatorAddress,
        uint64 redelegationTime
    ) external {
        Redelegation storage redelegation = redelegations[delegatorAddress][redelegationTime];
        require(redelegation.completionTime <= int64(uint64(block.timestamp)), "Redelegation not completed yet");
        require(redelegation.amount > 0, "No redelegated amount");

        uint256 amount = redelegation.amount;
        redelegation.amount = 0;

        Delegation storage delegationFrom = delegations[delegatorAddress][redelegation.validatorAddressFrom];
        Delegation storage delegationTo = delegations[delegatorAddress][redelegation.validatorAddressTo];
        delegationFrom.amount -= amount;
        delegationTo.amount += amount;

        delete redelegations[delegatorAddress][redelegationTime];
    }

    function delegation(
        address delegatorAddress,
        string memory validatorAddress
    ) external view returns (uint256 shares, Coin memory balance) {
        Delegation memory _delegation = delegations[delegatorAddress][validatorAddress];

        shares = _delegation.amount; // In this mock, shares are equal to the amount
        balance = Coin({
            denom: "utac",
            amount: _delegation.amount
        });
    }
}