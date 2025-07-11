import hre, {ethers} from "hardhat";

import path from "path";
import { transferOwnership } from "../utils/upgrade";

async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    const newOwner = "0x592e0D5f382E83406eADC6532a559A457aae7d3b";

    let addressesFilePath;
    if (hre.network.name === 'tac_mainnet') {
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    await transferOwnership(deployer, addressesFilePath, newOwner);
}

main();