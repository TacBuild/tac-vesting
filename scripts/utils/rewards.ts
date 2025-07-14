import { MerkleTree } from 'merkletreejs';
import { ethers, keccak256 } from 'ethers';

import fs from 'fs';
import { Address } from '@ton/ton';

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

        if (typeof rewardAmount !== 'string') {
            throw new Error(`Invalid reward amount for address ${tvmAddr}: ${rewardAmount}`);
        }

        const address = Address.parse(tvmAddr);
        const normalizedTVMAddress = address.toString({ bounceable: true, testOnly: false});

        rewardsConfig.push({
            userTVMAddress: normalizedTVMAddress,
            rewardAmount: ethers.parseEther(rewardAmount)
        });
    }

    return rewardsConfig;
}

export function saveRewardsConfig(filePath: string, rewards: RewardsConfig[]): void {
    const rewardsData: Record<string, string> = {};
    for (const reward of rewards) {
        // Convert the TVM address to a string and the reward amount to a string
        rewardsData[reward.userTVMAddress] = ethers.formatEther(reward.rewardAmount);
    }
    fs.writeFileSync(filePath, JSON.stringify(rewardsData, null, 2));
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
