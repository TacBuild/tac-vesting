import { MerkleTree } from 'merkletreejs';
import { ethers, keccak256 } from 'ethers';

import fs from 'fs';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

export type RewardsConfig = {
    userTVMAddress: string;
    rewardAmount: bigint;
};

export function loadRewadsConfig(filePath: string): RewardsConfig[] {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Rewards config file not found: ${filePath}`);
    }
    const data = fs.readFileSync(filePath, 'utf8');
    const conf = JSON.parse(data);

    const rewardsConfig: RewardsConfig[] = [];

    for (const [tvmAddr, rewardAmount] of Object.entries(conf)) {

        if (!tvmAddr.startsWith('EQ')) {
            throw new Error(`Invalid TVM address: ${tvmAddr}`);
        }

        if (typeof rewardAmount !== 'string') {
            throw new Error(`Invalid reward amount for address ${tvmAddr}: ${rewardAmount}`);
        }

        rewardsConfig.push({
            userTVMAddress: tvmAddr,
            rewardAmount: ethers.parseEther(rewardAmount)
        });
    }

    return rewardsConfig;
}

export function createLeaf(reward: RewardsConfig): string {
    // Encode the user's tvm address and reward amount into a leaf
    return keccak256(abiCoder.encode(['string', 'uint256'], [reward.userTVMAddress, reward.rewardAmount]));
}

export function createRewardsMerkleTree(rewards: RewardsConfig[]): MerkleTree {
    // Create a Merkle Tree from the hashed leaves
    const hashedLeaves = rewards.map(reward => {
        return createLeaf(reward);
    });
    return new MerkleTree(hashedLeaves, keccak256, { sortPairs: true });
}
