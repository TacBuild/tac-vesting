import hre, { ethers } from "hardhat";
import path from "path";
import { upgradeContract } from "../utils/upgrade";


// upgarade contracts
async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    let addressesFilePath;
    if (hre.network.name === 'tac_testnet_spb') {
        addressesFilePath = path.join(__dirname, '../../testnet_addresses.json');
    }
    else if (hre.network.name === 'tac_mainnet') {
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
    } else if (hre.network.name === 'tac_staking_test') {
        addressesFilePath = path.join(__dirname, '../../staking_test_addresses.json');
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    await upgradeContract(deployer, addressesFilePath);
}

main();