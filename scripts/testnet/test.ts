import { ethers } from "hardhat";
import { createLeaf, createRewardsMerkleTree, RewardsConfig } from "../utils/rewards";

import fs from "fs";
import path from "path";
import { Signer } from "ethers";
import { deployTacVesting } from "../utils/deploy";
import { testnetConfig } from "../config/config";
import { expect } from "chai";
import { StakingI } from "../../typechain-types/staking";
import { DistributionI } from "../../typechain-types/distribution";
import { setTimeout } from "timers/promises";

async function main() {
    // validator
    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);
    // deployer
    const deployer = ethers.Wallet.createRandom(ethers.provider);

    // send some TAC to deployer
    await (await validator.sendTransaction({
        to: deployer.address,
        value: ethers.parseEther("100") // 100 TAC
    })).wait();

    // deploy tacVesting contract
    const tacVesting = await deployTacVesting(deployer, testnetConfig);

    console.log(`TacVesting contract address: ${await tacVesting.getAddress()}`);

    const VESTING_STEPS = await tacVesting.VESTING_STEPS();
    const BASIS_POINTS = await tacVesting.BASIS_POINTS();
    const IMMEDIATE_PCT = await tacVesting.IMMEDIATE_PCT();
    const COMPLETION_TIMEOUT = 10n; // 10 seconds

    // generate user rewards
    const usersCount = 10;
    const users: Signer[] = [];
    const rewards: RewardsConfig[] = [];
    let totalRewards = 0n;

    for(let i = 0; i < usersCount; i++) {
        const user = ethers.Wallet.createRandom(ethers.provider);

        await (await validator.sendTransaction({
            to: user.address,
            value: ethers.parseEther("10") // 10 TAC
        })).wait();

        users.push(user);

        const rewardAmount = ethers.parseEther("1") * BigInt(Math.floor(Math.random() * 10 + 1)) // random reward between 1 and 10 TAC
        totalRewards += rewardAmount;
        rewards.push({
            userAddress: user.address,
            rewardAmount: rewardAmount
        });
    }

    const merkleTree = createRewardsMerkleTree(rewards);

    console.log(`Total rewards: ${ethers.formatEther(totalRewards)}`);

    console.log(`Merkle root: ${merkleTree.getHexRoot()}`);

    // set merkle root in TacVesting contract
    let tx = await tacVesting.setMerkleRoot(merkleTree.getHexRoot());
    await tx.wait();

    console.log(`Merkle root set in TacVesting contract: ${await tacVesting.merkleRoot()}`);

    // send total rewards to TacVesting contract
    await (await validator.sendTransaction({
        to: tacVesting.getAddress(),
        value: totalRewards
    })).wait();

    // balance after sending
    console.log(`TacVesting contract balance after sending: ${ethers.formatEther(await deployer.provider!.getBalance(tacVesting.getAddress()))}`);

    // do test:
    const validatorAddress = "tacvaloper1lyklak0wzhlq6sg96avvsyml4dyw2efep0fwm6";

    const receiver = ethers.Wallet.createRandom();
    const receiverAddress = await receiver.getAddress();

    console.log(`Receiver address: ${receiverAddress}`);

    const rewardsReceiver = ethers.Wallet.createRandom();
    const rewardsReceiverAddress = await rewardsReceiver.getAddress();

    console.log(`Rewards receiver address: ${rewardsReceiverAddress}`);

    const withdrawnRewards: {
        [key: string]: bigint;
    } = {}

    const stakingI: StakingI = await ethers.getContractAt("StakingI", testnetConfig.stackingContractAddress, deployer);
    const distributionI: DistributionI = await ethers.getContractAt("DistributionI", testnetConfig.distributionContractAddress, deployer);

    // make users choose staking or immediate rewards
    for (let i = 0; i < usersCount; i++) {
        const user = users[i];
        const reward = rewards[i];
        const userAddress = await user.getAddress();
        const proof = merkleTree.getHexProof(createLeaf(reward));

        console.log(`User ${i + 1}/${usersCount}: ${userAddress}, reward: ${ethers.formatEther(reward.rewardAmount)}`);

        const tacVestingBalanceBefore = await deployer.provider!.getBalance(tacVesting.getAddress());
        console.log(`TacVesting contract balance before: ${ethers.formatEther(tacVestingBalanceBefore)}`);

        // const doStaking = Math.round(Math.random()) === 0; // random boolean
        const doStaking = true;
        if (doStaking) {
            console.log(`User ${userAddress} chooses staking`);

            // choose staking
            let tx = await tacVesting.connect(user).chooseStaking(validatorAddress, reward.rewardAmount, proof);
            let rec = await tx.wait();

            withdrawnRewards[userAddress] = 0n;

            // check if event was emitted
            let eventFound = false;
            for (const log of rec!.logs) {
                const event = tacVesting.interface.parseLog(log);
                if (event?.name === "Delegated") {
                    console.log(`Delegated event: User ${event.args.user} delegated ${ethers.formatEther(event.args.amount)} TAC to validator ${event.args.validatorAddress}`);
                    eventFound = true;
                }
            }
            expect(eventFound, "Delegated event should be emitted").to.be.true;

            // check staking account was created
            const userInfo = await tacVesting.info(userAddress);
            expect(userInfo.stakingAccount).to.not.equal(ethers.ZeroAddress, "Staking account should be created");
            expect(userInfo.userTotalRewards).to.equal(reward.rewardAmount, "Amount should be equal to reward amount");
            expect(userInfo.unlocked).to.equal(0n, "User unlocked amount should be 0");
            expect(userInfo.withdrawn).to.equal(0n, "User withdrawn amount should be 0");
            expect(userInfo.choiceStartTime).to.equal((await rec!.getBlock()).timestamp, "Choice start time should be equal to block timestamp");

            // get delegation info
            const delegation = await stakingI.delegation(userInfo.stakingAccount, validatorAddress);
            console.log(`Delegation info: shares ${delegation.shares}`, `balance ${delegation.balance.amount} ${delegation.balance.denom}`);
            expect(delegation.balance.amount).to.equal(reward.rewardAmount, "Delegation amount should be equal to reward amount");

            const tacVestingBalanceAfter = await deployer.provider!.getBalance(tacVesting.getAddress());
            console.log(`TacVesting contract balance after: ${ethers.formatEther(tacVestingBalanceAfter)}`);
            expect(tacVestingBalanceAfter).to.equal(tacVestingBalanceBefore - reward.rewardAmount, "TacVesting contract balance should be decreased by reward amount");

        } else {
            // choose immediate withdraw
            console.log(`User ${userAddress} chooses immediate withdraw`);

            const receiverBalanceBefore = await deployer.provider!.getBalance(receiverAddress);

            let tx = await tacVesting.connect(user).chooseImmediateWithdraw(receiverAddress, reward.rewardAmount, proof);
            let rec = await tx.wait();

            const immediateWithdrawAmount = (reward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

            // chekc event
            let eventFound = false;
            for (const log of rec!.logs) {
                const event = tacVesting.interface.parseLog(log);
                if (event?.name === "Withdrawn") {
                    console.log(`Withdrawn event: User ${event.args.user} withdrawn ${ethers.formatEther(event.args.amount)} TAC to receiver ${event.args.receiver}`);
                    eventFound = true;
                }
            }
            expect(eventFound, "Withdrawn event should be emitted").to.be.true;

            withdrawnRewards[userAddress] = immediateWithdrawAmount;

            const userInfo = await tacVesting.info(userAddress);
            expect(userInfo.stakingAccount).to.equal(ethers.ZeroAddress, "Staking account should not be created");
            expect(userInfo.userTotalRewards).to.equal(reward.rewardAmount, "Amount should be equal to reward amount");
            expect(userInfo.unlocked).to.equal(immediateWithdrawAmount, "User unlocked amount should be equal to immediate withdraw amount");
            expect(userInfo.withdrawn).to.equal(immediateWithdrawAmount, "User withdrawn amount should be equal to immediate withdraw amount");
            expect(userInfo.choiceStartTime).to.equal((await rec!.getBlock()).timestamp, "Choice start time should be equal to block timestamp");
            const receiverBalanceAfter = await deployer.provider!.getBalance(receiverAddress);
            console.log(`Receiver balance after: ${ethers.formatEther(receiverBalanceAfter)}`);
            expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + immediateWithdrawAmount, "Receiver balance should be increased by immediate withdraw amount");
            const tacVestingBalanceAfter = await deployer.provider!.getBalance(tacVesting.getAddress());
            console.log(`TacVesting contract balance after: ${ethers.formatEther(tacVestingBalanceAfter)}`);
            expect(tacVestingBalanceAfter).to.equal(tacVestingBalanceBefore - immediateWithdrawAmount, "TacVesting contract balance should be decreased by immediate withdraw amount");
        }

        // sleep 10 seconds
        // await setTimeout(10 * 1000);
    }

    // for (let step = 1; step <= VESTING_STEPS; step++) {
    //     // wait for step duration
    //     console.log(`Waiting for step ${step} duration: ${testnetConfig.stepDuration} seconds...`);
    //     await setTimeout(parseInt(testnetConfig.stepDuration.toString()) * 1000);
    // }

}

main();