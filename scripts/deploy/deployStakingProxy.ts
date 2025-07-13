import hre, { ethers } from 'hardhat';
import { deployStakingProxy } from '../utils/deploy';
import { locatTestnetConfig, mainnetConfig, testnetConfig } from "../config/config";

import path from "path";
import { saveContractAddress } from '@tonappchain/evm-ccl';

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

    const stakingProxy = await deployStakingProxy(deployer, config);

    saveContractAddress(
        addressesFilePath,
        "stakingProxy",
        await stakingProxy.getAddress(),
    );
    console.log(`StakingProxy deployed to: ${await stakingProxy.getAddress()}`);
}

main();