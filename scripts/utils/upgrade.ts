import hre, { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import { default as inquirer } from "inquirer";

import fs from "fs";

export type ContractAddresses = {
    [contractName: string]: string
}

function guessContractName(contractName: string, names: string[]): string | undefined {
    const matched = names.find(e => e?.match(new RegExp(contractName, "i")));
    return matched;
}

export async function upgradeContract(
    deployer: Signer,
    addressesFilePath: string,
    needsForceImport: boolean = false,
): Promise<void> {

    const network = hre.network.name;

    console.log(`Upgrading contracts on ${network}, file: ${addressesFilePath}`);

    if (!fs.existsSync(addressesFilePath)) {
        throw new Error(`File ${addressesFilePath} not found`);
    }

    const action = needsForceImport ? "force import" : "upgrade";

    const addresses = JSON.parse(fs.readFileSync(addressesFilePath, "utf-8")) as ContractAddresses;

    const contractNames = Object.keys(addresses);

    const { contractName } = await inquirer.prompt<{ contractName: string }>([
        {
            type: "list",
            name: "contractName",
            message: `Select a contract to ${action}:`,
            choices: contractNames
        }
    ]);

    const artifacts = await hre.artifacts.getAllFullyQualifiedNames();

    const matched = guessContractName(contractName, artifacts);
    if (!matched) {
        throw new Error(`Contract ${contractName} not found in atrifacts`);
    }

    const address = addresses[contractName];
    console.log(`Contract: ${matched!}`);
    console.log(`Network: ${hre.network.name}`);
    console.log(`Address: ${address}`);
    // Ask for confirmation
    const { confirmUpgrade } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirmUpgrade",
            message: `Do you want to proceed with the ${action}?`,
            default: false,
        },
    ]);
    if (!confirmUpgrade) {
        console.log(`${action} cancelled.`);
        return;
    }

    const artifact = hre.artifacts.readArtifactSync(matched);
    const ImplFactory = await ethers.getContractFactoryFromArtifact(artifact, deployer);

    if (needsForceImport === true) {
        console.log(`Force importing contract ${matched} at ${addresses[contractName]}`);
        await upgrades.forceImport(addresses[contractName], ImplFactory);
    } else {
        console.log(`Upgrading contract ${matched} at ${addresses[contractName]}`);
        if (hre.network.name === "tac_mainnet") { // for mainnet we use multisig as owner
            const newImplAddress = await upgrades.prepareUpgrade(addresses[contractName], ImplFactory);
            console.log(`Prepare upgrade done, new implementation address: ${newImplAddress.toString()}`);
        } else {
            await upgrades.upgradeProxy(addresses[contractName], ImplFactory);
            const newImplAddress = await upgrades.erc1967.getImplementationAddress(addresses[contractName]);
            console.log(`Upgrade done, new implementation address: ${newImplAddress}`);
        }
    }
}

export async function transferOwnership(
    deployer: Signer,
    addressesFilePath: string,
    newOwner: string,
): Promise<void> {

    const network = hre.network.name;

    console.log(`Transferring ownership on ${network}, file: ${addressesFilePath}`);

    if (!fs.existsSync(addressesFilePath)) {
        throw new Error(`File ${addressesFilePath} not found`);
    }

    const addresses = JSON.parse(fs.readFileSync(addressesFilePath, "utf-8")) as ContractAddresses;

    const contractNames = Object.keys(addresses);

    const { contractName } = await inquirer.prompt<{ contractName: string }>([
        {
            type: "list",
            name: "contractName",
            message: `Select a contract to transfer ownership:`,
            choices: contractNames
        }
    ]);

    const artifacts = await hre.artifacts.getAllFullyQualifiedNames();

    const matched = guessContractName(contractName, artifacts);
    if (!matched) {
        throw new Error(`Contract ${contractName} not found in atrifacts`);
    }

    const address = addresses[contractName];
    console.log(`Contract: ${matched}`);
    console.log(`Network: ${hre.network.name}`);
    console.log(`Address: ${address}`);

    const contract = await ethers.getContractAt(matched, address, deployer);

    const currentOwner = await contract.owner();

    console.log(`Current owner: ${currentOwner}`);
    if (currentOwner.toLowerCase() !== (await deployer.getAddress()).toLowerCase()) {
        throw new Error(`Deployer is not the owner of the contract ${contractName} at ${address}`);
    }

    // Ask for confirmation
    const { confirmTransfer } = await inquirer.prompt([
        {
            type: "confirm",
            name: "confirmTransfer",
            message: `Do you want to transfer ownership to ${newOwner}?`,
            default: false,
        },
    ]);
    if (!confirmTransfer) {
        console.log(`Ownership transfer cancelled.`);
        return;
    }

    console.log(`Transferring ownership to ${newOwner}`);

    const tx = await contract.transferOwnership(newOwner);
    await tx.wait();

    console.log(`Ownership transferred to ${newOwner}`);
}