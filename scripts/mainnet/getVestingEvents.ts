import hre, { ethers } from "hardhat";
import { loadContractAddresses } from "../utils/deploy";
import { loadRewadsConfig } from "../utils/rewards";
import { DelegatedEvent, WithdrawnEvent } from "../../typechain-types/contracts/TacVesting";

import path from "path";
import fs from "fs";


async function main() {
    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    let addressesFilePath;
    let rewardsFilePath;
    if (hre.network.name === 'tac_mainnet') {
        addressesFilePath = path.join(__dirname, '../../mainnet_addresses.json');
        rewardsFilePath = path.join(__dirname, `../deploy/rewards/mainnet.json`);
    } else {
        throw new Error(`Unsupported network: ${hre.network.name}`);
    }

    let scannedBlock: number = 2201656;
    const scanStep = 10000;

    const addresses = loadContractAddresses(addressesFilePath);
    const data = fs.readFileSync(rewardsFilePath, 'utf8');
    const rewards = JSON.parse(data);

    const tacVesting = await ethers.getContractAt("TacVesting", addresses.tacVesting, deployer);

    let delegated = 0;
    let withdrawn = 0;

    let latestBlock = await ethers.provider.getBlockNumber();

    const delegatedUsers = [];
    const withdrawnUsers = [];

    let forfeitUserRewards = 0n;

    const IMMEDIATE_PCT = await tacVesting.IMMEDIATE_PCT();
    const BASIS_POINTS = await tacVesting.BASIS_POINTS();

    while (scannedBlock < latestBlock) {

        const scanFrom = scannedBlock + 1;
        const scanTo = scanFrom + scanStep > latestBlock ? latestBlock : scanFrom + scanStep;

        let logs = await ethers.provider.getLogs({
            fromBlock: scanFrom,
            toBlock: scanTo,
            address: await tacVesting.getAddress(),
            topics: [tacVesting.interface.getEvent("Delegated").topicHash]
        });

        logs.push(...await ethers.provider.getLogs({
            fromBlock: scanFrom,
            toBlock: scanTo,
            address: await tacVesting.getAddress(),
            topics: [tacVesting.interface.getEvent("Withdrawn").topicHash]
        }));

        console.log(`Logs found ${logs.length} from block ${scanFrom} to ${scanTo}`);

        for (const log of logs) {
            const event = tacVesting.interface.parseLog(log);
            if (!event) continue;

            if (event.name === "Delegated") {
                const typedEvent = event as unknown as DelegatedEvent.LogDescription;
                const userTVMAddress = typedEvent.args.userTVMAddress;
                delegatedUsers.push(userTVMAddress);
                delegated++;
            } else if (event.name === "Withdrawn") {
                const typedEvent = event as unknown as WithdrawnEvent.LogDescription;
                const userTVMAddress = typedEvent.args.userTVMAddress;
                withdrawnUsers.push(userTVMAddress);
                const userTotalRewards = ethers.parseEther(rewards[userTVMAddress]);
                forfeitUserRewards += (userTotalRewards * (BASIS_POINTS - IMMEDIATE_PCT)) / BASIS_POINTS;
                withdrawn++;
            }
        }

        scannedBlock = scanTo;
        latestBlock = await ethers.provider.getBlockNumber();
    }

    console.log(`Delegated events: ${delegated}`);
    console.log(`Withdrawn events: ${withdrawn}`);
    console.log(`Forfeit user rewards: ${ethers.formatEther(forfeitUserRewards)} TAC`);

    // let result = "";

    // for (const userTVMAddress of delegatedUsers) {
    //     result += `${userTVMAddress}\n`;
    // }

    // // save to file
    // const fp = path.join(__dirname, `delegated_users.txt`);
    // fs.writeFileSync(fp, result);
}

main();