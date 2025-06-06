import { ethers } from "hardhat";
import { createLeaf, createRewardsMerkleTree, RewardsConfig } from "../utils/rewards";

import fs from "fs";
import path from "path";
import { Signer } from "ethers";
import { deployTacVesting } from "../utils/deploy";
import { DistributionPrecompileAddress, StakingPrecompileAddress, testnetConfig } from "../config/config";
import { expect } from "chai";
import { StakingI } from "../../typechain-types/staking";
import { DistributionI } from "../../typechain-types/distribution";
import { setTimeout } from "timers/promises";
import { GasConsumer } from "../../typechain-types";

async function main() {
    // validator
    const validatorAddress = "tacvaloper17saprlqvmefcwa8we2tmjajcketp3k2n6k3p80";
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

    const GasConsumer = await ethers.getContractFactory("GasConsumer", deployer);
    const gasConsumer: GasConsumer = await GasConsumer.deploy();
    await gasConsumer.waitForDeployment();

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

    const receiver = ethers.Wallet.createRandom();
    const receiverAddress = await receiver.getAddress();

    console.log(`Receiver address: ${receiverAddress}`);

    const rewardsReceiver = ethers.Wallet.createRandom();
    const rewardsReceiverAddress = await rewardsReceiver.getAddress();

    console.log(`Rewards receiver address: ${rewardsReceiverAddress}`);

    const withdraws: {
        [key: string]: bigint;
    } = {};

    const undelegations: {
        [key: string]: {
            done: boolean;
            amount: bigint;
            completionTime: bigint;
        }[];
    } = {};

    const stakingI: StakingI = await ethers.getContractAt("StakingI", StakingPrecompileAddress, deployer);
    const distributionI: DistributionI = await ethers.getContractAt("DistributionI", DistributionPrecompileAddress, deployer);
    let lastChoiceTime = 0n;
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
            let tx = await tacVesting.connect(user).chooseStaking(validatorAddress, reward.rewardAmount, proof, {gasLimit: 1000000});
            let rec = await tx.wait();

            withdraws[userAddress] = 0n;

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

            withdraws[userAddress] = immediateWithdrawAmount;

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

        const unserInfo = await tacVesting.info(userAddress);
        if (unserInfo.choiceStartTime > lastChoiceTime) {
            lastChoiceTime = unserInfo.choiceStartTime; // update last choice time
        }
    }

    for (let step = 1n; step <= VESTING_STEPS; step++) {
        // wait for step duration
        const lastChoiceTimeStep = lastChoiceTime + step * BigInt(testnetConfig.stepDuration);
        const startTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
        if (startTimestamp < lastChoiceTimeStep) {
            console.log(`Waiting for step ${step} duration: ${lastChoiceTimeStep - startTimestamp} seconds...`);
            while(1) {
                const currentTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
                if (currentTimestamp > lastChoiceTimeStep) {
                    break; // step duration reached
                }
                // consume gas for generating rewards
                let tx = await gasConsumer.connect(validator).consumeGas(300, {gasLimit: 25000000});
                let res = await tx.wait();
            }
        }
        console.log(`Step ${step} passed...`);

        // check users can claim rewards
        for (let i = 0; i < usersCount; i++) {
            const user = users[i];
            const userReward = rewards[i];
            const userAddress = await user.getAddress();

            const userInfo = await tacVesting.info(userAddress);
            console.log(`User ${i + 1}/${usersCount}: ${userAddress}`);
            // if choosen staking
            if (userInfo.stakingAccount !== ethers.ZeroAddress) {
                // try to claim rewards
                const rewardsReceiverBalanceBefore = await deployer.provider!.getBalance(rewardsReceiverAddress);
                let tx = await tacVesting.connect(user).claimDelegatorRewards(rewardsReceiverAddress, validatorAddress, {gasLimit: 1000000});
                let rec = await tx.wait();
                const rewardsReceiverBalanceAfter = await deployer.provider!.getBalance(rewardsReceiverAddress);
                console.log(`Rewards received: ${ethers.formatEther(rewardsReceiverBalanceAfter - rewardsReceiverBalanceBefore)} TAC`);

                // check unlocked
                let expectedUnlocked;
                if (step === VESTING_STEPS) {
                    expectedUnlocked = userReward.rewardAmount;
                } else {
                    expectedUnlocked = (userReward.rewardAmount * step) / VESTING_STEPS;
                }
                const unlocked = await tacVesting.getUnlocked(userAddress);
                expect(expectedUnlocked).to.equal(unlocked, `Unlocked amount should be ${ethers.formatEther(expectedUnlocked)} TAC for step ${step}`);

                const expectedAvailableToUndelegate = expectedUnlocked - withdraws[userAddress];
                const availableToUndelegate = await tacVesting.getAvailable(userAddress);
                expect(expectedAvailableToUndelegate).to.equal(availableToUndelegate, `Available to undelegate amount should be ${ethers.formatEther(expectedAvailableToUndelegate)} TAC for step ${step}`);

                console.log(`Unlocked amount: ${ethers.formatEther(unlocked)} TAC`);
                console.log(`Available to undelegate: ${ethers.formatEther(availableToUndelegate)} TAC`);
                // try undelegate
                tx = await tacVesting.connect(user).undelegate(validatorAddress, availableToUndelegate, {gasLimit: 1000000});
                rec = await tx.wait();

                // check Undelegated event
                let eventFound = false;
                for (const log of rec!.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === "Undelegated") {
                        console.log(`Undelegated event: User ${event.args.user} undelegated ${ethers.formatEther(event.args.amount)} TAC from validator ${event.args.validatorAddress} completion time ${event.args.completionTime}`);
                        eventFound = true;
                        // write undelegation info
                        if (!undelegations[userAddress]) {
                            undelegations[userAddress] = [];
                        }
                        undelegations[userAddress].push({
                            done: false,
                            amount: event.args.amount,
                            completionTime: event.args.completionTime
                        });
                    }
                }
                expect(eventFound, "Undelegated event should be emitted").to.be.true;

                withdraws[userAddress] += availableToUndelegate;
            } else { // if choosen immediate withdraw
                // check unlocked: first transfer + (total - first) * step / VESTING_STEPS
                const firstTransfer = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;
                    // (total - firstTransfer) / VESTING_STEPS should be unlocked
                const stepUnlockAmount = (userReward.rewardAmount - firstTransfer) / VESTING_STEPS;
                let expectedUnlocked;
                if (step === VESTING_STEPS) {
                    expectedUnlocked = userReward.rewardAmount;
                } else {
                    expectedUnlocked = firstTransfer + stepUnlockAmount * step;
                }

                const unlocked = await tacVesting.getUnlocked(userAddress);
                expect(expectedUnlocked).to.equal(unlocked, `Unlocked amount should be ${ethers.formatEther(expectedUnlocked)} TAC for step ${step}`);

                const expectedAvailableToWithdraw = expectedUnlocked - withdraws[userAddress];
                const availableToWithdraw = await tacVesting.getAvailable(userAddress);
                expect(expectedAvailableToWithdraw).to.equal(availableToWithdraw, `Available to undelegate amount should be ${ethers.formatEther(expectedAvailableToWithdraw)} TAC for step ${step}`);

                console.log(`Unlocked amount: ${ethers.formatEther(unlocked)} TAC`);
                console.log(`Available to withdraw: ${ethers.formatEther(availableToWithdraw)} TAC`);
                // try withdraw

                const receiverBalanceBefore = await deployer.provider!.getBalance(receiverAddress);
                let tx = await tacVesting.connect(user).withdraw(receiverAddress, availableToWithdraw, {gasLimit: 1000000});
                const rec = await tx.wait();
                const receiverBalanceAfter = await deployer.provider!.getBalance(receiverAddress);
                console.log(`Withdrawn amount: ${ethers.formatEther(receiverBalanceAfter - receiverBalanceBefore)} TAC`);
                // check Withdrawn event
                let eventFound = false;
                for (const log of rec!.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === "Withdrawn") {
                        console.log(`Withdrawn event: User ${event.args.user} withdrawn ${ethers.formatEther(event.args.amount)} TAC to receiver ${event.args.receiver}`);
                        eventFound = true;
                    }
                }
                expect(eventFound, "Withdrawn event should be emitted").to.be.true;
                withdraws[userAddress] += availableToWithdraw;
            }
        }
    }

    // try receive undelegated funds
    while (true) {
        let allDone = true;
        for (let i = 0; i < usersCount; i++) {
            const currBlockTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            const user = users[i];
            const userAddress = await user.getAddress();

            if (!undelegations[userAddress]) {
                continue; // no undelegations for this user
            }

            console.log(`Checking undelegations for user ${userAddress}`);

            for (let undelegation of undelegations[userAddress]) {
                console.log(`Undelegation: done ${undelegation.done}, amount ${ethers.formatEther(undelegation.amount)}, completion time ${undelegation.completionTime}`);
                if (undelegation.done) {
                    continue; // already done
                }

                // check if undelegation (+10 sec) is completed
                if (currBlockTimestamp + 10n < undelegation.completionTime) {
                    continue; // not completed yet
                }

                console.log(`User ${userAddress} has undelegated funds to receive: ${ethers.formatEther(undelegation.amount)} TAC`);

                // try receive undelegated funds
                const receiverBalanceBefore = await deployer.provider!.getBalance(receiverAddress);
                let tx = await tacVesting.connect(user).withdrawFromAccount(receiverAddress, undelegation.amount, {gasLimit: 1000000});
                let rec = await tx.wait();
                // check WithdrawnFromAccount event
                let eventFound = false;
                for (const log of rec!.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === "WithdrawnFromAccount") {
                        console.log(`WithdrawnFromAccount event: User ${event.args.user} withdrawn undelegated ${ethers.formatEther(event.args.amount)} TAC to receiver ${event.args.receiver}`);
                        eventFound = true;
                    }
                }
                expect(eventFound, "WithdrawnFromAccount event should be emitted").to.be.true;

                const receiverBalanceAfter = await deployer.provider!.getBalance(receiverAddress);
                console.log(`Received undelegated amount: ${ethers.formatEther(receiverBalanceAfter - receiverBalanceBefore)} TAC`);

                undelegation.done = true; // mark as done
            }

            // check all undelegations are done
            for (let undelegation of undelegations[userAddress]) {
                if (!undelegation.done) {
                    allDone = false;
                    break;
                }
            }
        }
        if (allDone) {
            console.log("All undelegations are done");
            break;
        }
        await setTimeout(10 * 1000); // wait for 10 seconds before next check
    }

    const tacVestingBalance = await deployer.provider!.getBalance(tacVesting.getAddress());
    const receiverBalance = await deployer.provider!.getBalance(receiverAddress);
    for (let i = 0; i < usersCount; i++) {
        const user = users[i];
        const userAddress = await user.getAddress();
        const userInfo = await tacVesting.info(userAddress);
        const stakingAccountBalance = await deployer.provider!.getBalance(userInfo.stakingAccount);

        console.log(`User ${i + 1}/${usersCount}: ${userAddress} staking account balance: ${stakingAccountBalance} TAC`);
    }

    console.log(`TacVesting contract balance: ${tacVestingBalance} TAC`);
    console.log(`Receiver balance: ${receiverBalance} TAC`);
    console.log(`Total rewards: ${totalRewards} TAC`);
}

main();