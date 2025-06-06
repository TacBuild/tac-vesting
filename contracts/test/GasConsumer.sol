// SPDX-License-Identifier: MIT

pragma solidity ^0.8.28;

contract GasConsumer {

    mapping(bytes32 => uint256) porozhnyak1;
    mapping(bytes32 => uint256) porozhnyak2;
    mapping(bytes32 => uint256) porozhnyak3;

    function consumeGas(uint256 iterations) external {
        for (uint256 i = 0; i < iterations; i++) {
            // Use a mapping to consume gas
            porozhnyak1[keccak256(abi.encodePacked(i, block.timestamp))] = i;
            porozhnyak2[keccak256(abi.encodePacked(i * 2, block.timestamp))] = i * 2;
            porozhnyak3[keccak256(abi.encodePacked(i * 3, block.timestamp))] = i * 3;
        }
    }
}