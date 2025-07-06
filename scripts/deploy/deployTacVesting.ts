import hre, { ethers } from "hardhat";
import { deployTacVesting } from "../utils/deploy";
import { locatTestnetConfig, mainnetConfig, testnetConfig } from "../config/config";
import { RewardsConfig, createRewardsMerkleTree } from "../utils/rewards";

import fs from "fs";
import path from "path";

function loadRewadsConfig(filePath: string): RewardsConfig[] {
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

async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    let config;
    let addressesFilePath;
    let rewardsFilePath;
    if (hre.network.name === 'tac_testnet_spb') {
        config = testnetConfig;
        addressesFilePath = path.join(__dirname, '../../testnet_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/testnet.json`);
    }
    else if (hre.network.name === 'tac_mainnet') {
        config = mainnetConfig;
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/mainnet.json`);
    } else if (hre.network.name === 'tac_staking_test') {
        config = locatTestnetConfig;
        addressesFilePath = path.join(__dirname, '../../staking_test_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/staking_test.json`);
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    const tacVesting = await deployTacVesting(deployer, config);

    console.log(`TacVesting deployed at: ${await tacVesting.getAddress()}`);


    const rewardsConfig = loadRewadsConfig(rewardsFilePath);
    const tree = createRewardsMerkleTree(rewardsConfig);
    // set rewards merkle root
    const rewardsMerkleRoot = tree.getHexRoot();

    let tx = await tacVesting.setMerkleRoot(rewardsMerkleRoot);
    await tx.wait();
    console.log(`Rewards merkle root set: ${rewardsMerkleRoot}`);

    if (hre.network.name !== 'tac_mainnet') {
        console.log("Fund the contract with TAC tokens for testing purposes");
        let totalRewards = 0n;
        for (const reward of rewardsConfig) {
            totalRewards += reward.rewardAmount;
        }
        // send some TAC to the contract for testing
        let tx = await deployer.sendTransaction({
            to: await tacVesting.getAddress(),
            value: totalRewards
        })
        await tx.wait();
    } else {
        console.log("!!!!! Dont forget to fund the contract with TAC tokens on mainnet !!!!!");
    }

    let addresses: { [key: string]: string } = {
        tacVesting: await tacVesting.getAddress()
    };

    fs.writeFileSync(
        addressesFilePath,
        JSON.stringify(addresses, null, 2),
        'utf8'
    );

    console.log(`Finished deploying TacVesting on ${hre.network.name} network`);
}

main();