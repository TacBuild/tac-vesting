import hre, { ethers } from "hardhat";
import { deployTacVesting, loadContractAddresses } from "../utils/deploy";
import { locatTestnetConfig, mainnetConfig, testnetConfig } from "../config/config";
import { loadRewadsConfig, createRewardsMerkleTree } from "../utils/rewards";

import path from "path";
import { saveContractAddress } from "@tonappchain/evm-ccl";

async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    let addressesFilePath;
    let rewardsFilePath;
    if (hre.network.name === 'tac_testnet_spb') {
        addressesFilePath = path.join(__dirname, '../../testnet_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/testnet.json`);
    }
    else if (hre.network.name === 'tac_mainnet') {
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/mainnet.json`);
    } else if (hre.network.name === 'tac_staking_test') {
        addressesFilePath = path.join(__dirname, '../../staking_test_addresses.json');
        rewardsFilePath = path.join(__dirname, `./rewards/staking_test.json`);
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    const addresses = loadContractAddresses(addressesFilePath);
    const rewardsConfig = loadRewadsConfig(rewardsFilePath);

    const tree = createRewardsMerkleTree(rewardsConfig);

    console.log(`New rewards merkle root: ${tree.getHexRoot()}`);

    const tacVesting = await ethers.getContractAt("TacVesting", addresses.tacVesting, deployer);

    let tx = await tacVesting.setMerkleRoot(tree.getHexRoot());
    await tx.wait();

    console.log(`Rewards merkle root set: ${await tacVesting.merkleRoot()}`);
}

main();