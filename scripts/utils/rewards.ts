import { MerkleTree } from 'merkletreejs';
import { ethers, keccak256 } from 'ethers';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export type RewardsConfig = {
    userAddress: string;
    rewardAmount: bigint;
};

export function createLeaf(reward: RewardsConfig): string {
    // Encode the user address and reward amount into a leaf
    return keccak256(keccak256(abiCoder.encode(['address', 'uint256'], [reward.userAddress, reward.rewardAmount])));
}

export function createRewardsMerkleTree(rewards: RewardsConfig[]): MerkleTree {
    // Create a Merkle Tree from the hashed leaves
    const hashedLeaves = rewards.map(reward => {
        return createLeaf(reward);
    });
    return new MerkleTree(hashedLeaves, keccak256, { sortPairs: true });
}
