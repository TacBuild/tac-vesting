import hre, { ethers } from "hardhat";
import { deployTacVesting } from "../utils/deploy";
import { locatTestnetConfig, mainnetConfig, testnetConfig } from "../config/config";
import { loadRewadsConfig, createRewardsMerkleTree } from "../utils/rewards";

import path from "path";
import { saveContractAddress } from "@tonappchain/evm-ccl";

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

    let totalRewards = 0n;
    for (const reward of rewardsConfig) {
        totalRewards += reward.rewardAmount;
    }

    if (hre.network.name !== 'tac_mainnet') {
        console.log("Fund the contract with TAC tokens for testing purposes");
        // send some TAC to the contract for testing
        let tx = await deployer.sendTransaction({
            to: await tacVesting.getAddress(),
            value: totalRewards
        })
        await tx.wait();
    } else {
        console.log(`!!!!! Dont forget to fund the contract with TAC tokens on mainnet with ${ethers.formatEther(totalRewards)} $TAC !!!!!`);
    }

    saveContractAddress(
        addressesFilePath,
        "tacVesting",
        await tacVesting.getAddress(),
    )

    console.log(`Finished deploying TacVesting on ${hre.network.name} network`);
}

main();