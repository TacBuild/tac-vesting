import hre, { ethers } from "hardhat";
import { deployTacVesting } from "../utils/deploy";
import { mainnetConfig, testnetConfig } from "../config/config";

import fs from "fs";
import path from "path";

async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    let config;
    let addressesFilePath;
    if (hre.network.name === 'tac_testnet_spb') {
        config = testnetConfig;
        addressesFilePath = path.join(__dirname, '../../testnet_addresses.json');
    }
    else if (hre.network.name === 'tac_mainnet') {
        config = mainnetConfig;
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    const tacVesting = await deployTacVesting(deployer, config);

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