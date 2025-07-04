import hre, { ethers } from "hardhat";
import { deployTacVesting } from "../utils/deploy";
import { mainnetConfig, testnetConfig } from "../config/config";
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
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    const rewardsConfig = loadRewadsConfig(rewardsFilePath);

    const tree = createRewardsMerkleTree(rewardsConfig);

    const tacVesting = await deployTacVesting(deployer, config);

    // set rewards merkle root
    const rewardsMerkleRoot = tree.getHexRoot();

    let tx = await tacVesting.setMerkleRoot(rewardsMerkleRoot);
    await tx.wait();
    console.log(`Rewards merkle root set: ${rewardsMerkleRoot}`);

    let addresses: { [key: string]: string } = {
        tacVesting: await tacVesting.getAddress()
    };

    fs.writeFileSync(
        addressesFilePath,
        JSON.stringify(addresses, null, 2),
        'utf8'
    );
}

main();