import { AddressLike, ethers } from "ethers";

import stakingAccountArtifact from "../../artifacts/contracts/StakingAccount.sol/StakingAccount.json";
const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export function calculateStakingAccountAddress(
    tacVestingAddress: string,
    userAddress: string,
): AddressLike {
    const salt = ethers.keccak256(
        abiCoder.encode(
            ["address"],
            [userAddress],
        ),
    );
    return ethers.getCreate2Address(
        tacVestingAddress,
        salt,
        ethers.keccak256(stakingAccountArtifact.bytecode),
    );
}