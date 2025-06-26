import hre, { ethers } from "hardhat";
import { createLeaf, createRewardsMerkleTree, RewardsConfig } from "../utils/rewards";

import { Signer, TransactionReceipt } from "ethers";
import { deployTacVesting } from "../utils/deploy";
import { DistributionPrecompileAddress, StakingPrecompileAddress, localConfig } from "../config/config";
import { expect, use } from "chai";
import { StakingI } from "../../typechain-types/staking";
import { DistributionI } from "../../typechain-types/distribution";
import { setTimeout } from "timers/promises";
import { GasConsumer } from "../../typechain-types";
import { TacSdk, Network, SenderFactory, SenderAbstraction, EvmProxyMsg, startTracking, StageName } from "@tonappchain/sdk";
import { TonClient } from "@ton/ton";
import { getCCLArtifacts } from "@tonappchain/evm-ccl";
import { CrossChainLayer } from "@tonappchain/evm-ccl/dist/typechain-types";
import { UndelegatedEvent } from "../../typechain-types/contracts/TacVesting";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

async function main() {
    // validator
    const validatorAddress = "tacvaloper1l9xzp9uqjl6dxpfe2mepnp446n7pep3lp6el69";
    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);
    // deployer
    const deployer = ethers.Wallet.createRandom().connect(ethers.provider);

    const cclArtifacts = await getCCLArtifacts();
    const crossChainLayer: CrossChainLayer = await ethers.getContractAtFromArtifact(cclArtifacts.readArtifactSync("CrossChainLayer"), localConfig.crossChainLayerAddress, deployer) as unknown as CrossChainLayer;
    console.log(`CrossChainLayer contract address: ${await crossChainLayer.getAddress()}`);
    const tacNativeAddress = await crossChainLayer.NATIVE_TOKEN_ADDRESS();
    console.log(`TAC native address: ${tacNativeAddress}`);

    // send some TAC to deployer
    await (await validator.sendTransaction({
        to: deployer.address,
        value: ethers.parseEther("100") // 100 TAC
    })).wait();

    const tonClientEndpoint = process.env.TON_CLIENT_ENDPOINT;
    const tonClientApiKey = process.env.TON_CLIENT_API_KEY;

    let tonClient: TonClient | undefined;
    if (tonClientEndpoint && tonClientApiKey) {
        tonClient = new TonClient({
            endpoint: tonClientEndpoint,
            apiKey: tonClientApiKey,
        });
    }

    const localhostNodeProvider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
    const sdkParams = {
        network: Network.TESTNET,
        customLiteSequencerEndpoints: ["http://127.0.0.1:8080"],
        TACParams: {
            provider: localhostNodeProvider,
            settingsAddress: "0x78d84987998823714F2b45Ab95850E4240Df6381",
        },
        TONParams: {
            settingsAddress: "EQBoFw42dxrFcBH4Wqdm7NNKxIwj6fMnl-2zIPs02Xrf_HPG",
        },
    }

    const tacSdk = await TacSdk.create(sdkParams);
    const tacJettonAddress = await tacSdk.getTVMTokenAddress(tacNativeAddress);
    console.log(`TAC jetton address: ${tacJettonAddress}`);

    // setup TON user's wallets
    const tonMnemonics = process.env.TON_TEST_MNEMONICS!.split(",");
    const senders: SenderAbstraction[] = [];
    for (let mnemonic of tonMnemonics) {
        const sender = await SenderFactory.getSender({
            network: Network.TESTNET,
            version: "V5R1",
            mnemonic: mnemonic,
        });
        senders.push(sender);
    }

    // deploy tacVesting contract
    const tacVesting = await deployTacVesting(deployer, localConfig);

    const GasConsumer = await ethers.getContractFactory("GasConsumer", deployer);
    const gasConsumer: GasConsumer = await GasConsumer.deploy();
    await gasConsumer.waitForDeployment();

    console.log(`TacVesting contract address: ${await tacVesting.getAddress()}`);

    const VESTING_STEPS = await tacVesting.VESTING_STEPS();
    const BASIS_POINTS = await tacVesting.BASIS_POINTS();
    const IMMEDIATE_PCT = await tacVesting.IMMEDIATE_PCT();

    // generate user rewards
    const usersCount = senders.length;
    const rewards: RewardsConfig[] = [];
    let totalRewards = 0n;
    let usersJettonBalanceBefore = 0n;
    for(let i = 0; i < usersCount; i++) {

        const rewardAmount = ethers.parseEther("1") * BigInt(Math.floor(Math.random() * 10 + 1)) // random reward between 1 and 10 TAC
        totalRewards += rewardAmount;
        rewards.push({
            userTVMAddress: senders[i].getSenderAddress(), // add TON user wallet address
            rewardAmount: rewardAmount
        });

        const userJettonBalance = await tacSdk.getUserJettonBalance(senders[i].getSenderAddress(), tacJettonAddress);
        usersJettonBalanceBefore += userJettonBalance;
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

    async function sendMessageToTacVesting(sender: SenderAbstraction, methodName: string, encodedParameters: string, isRoundTrip: boolean): Promise<TransactionReceipt> {
        const evmProxyMsg: EvmProxyMsg = {
            evmTargetAddress: await tacVesting.getAddress(),
            methodName: methodName,
            encodedParameters: encodedParameters,
        }

        try {
            const result = await tacSdk.sendCrossChainTransaction(evmProxyMsg, sender, []);

            const stages = await startTracking(result, Network.TESTNET, {customLiteSequencerEndpoints: sdkParams.customLiteSequencerEndpoints, returnValue: true, tableView: false});

            if (!stages) {
                throw new Error(`Transaction for ${methodName} call tracking failed`);
            }

            let lastStage;
            if (isRoundTrip) {
                lastStage = StageName.EXECUTED_IN_TON;
            } else {
                lastStage = StageName.EXECUTED_IN_TAC;
            }

            if (!stages[lastStage].exists) {
                console.log(JSON.stringify(stages, null, 2));
                throw new Error(`Transaction for ${methodName} call not executed in ${lastStage}`);
            }

            console.log(`Transaction for ${methodName} call successfully executed in ${lastStage}`);

            const tacTxHash = stages[StageName.EXECUTED_IN_TAC].stageData!.transactions![0].hash;
            const txReceipt = await ethers.provider.getTransactionReceipt(tacTxHash);

            if (!txReceipt) {
                throw new Error(`Transaction receipt ${tacTxHash} for ${methodName} call not found in TAC`);
            }

            return txReceipt;
        } catch (error) {
            console.error(`Error while sending message to TacVesting contract for ${methodName}:`, error);
            throw error;
        }
    }

    const stakingI: StakingI = await ethers.getContractAt("StakingI", StakingPrecompileAddress, deployer);
    const distributionI: DistributionI = await ethers.getContractAt("DistributionI", DistributionPrecompileAddress, deployer);
    let lastChoiceTime = 0n;
    // make users choose staking or immediate rewards
    for (let i = 0; i < usersCount; i++) {
        const reward = rewards[i];
        const userAddress = reward.userTVMAddress;
        const proof = merkleTree.getHexProof(createLeaf(reward));

        console.log(`User ${i + 1}/${usersCount}: ${userAddress}, reward: ${ethers.formatEther(reward.rewardAmount)}`);

        const tacVestingBalanceBefore = await deployer.provider!.getBalance(tacVesting.getAddress());
        console.log(`TacVesting contract balance before: ${ethers.formatEther(tacVestingBalanceBefore)}`);

        // const doStaking = Math.round(Math.random()) === 0; // random boolean
        const doStaking = true;
        if (doStaking) {
            console.log(`User ${userAddress} chooses staking`);

            // choose staking
            let encodedParameters = abiCoder.encode(["tuple(string,uint256,bytes32[])"], [[validatorAddress, reward.rewardAmount, proof]]);
            await sendMessageToTacVesting(senders[i], "chooseStaking", encodedParameters, false);

            withdraws[userAddress] = 0n;

            // check staking account was created
            const userInfo = await tacVesting.info(userAddress);
            expect(userInfo.stakingAccount).to.not.equal(ethers.ZeroAddress, "Staking account should be created");
            expect(userInfo.userTotalRewards).to.equal(reward.rewardAmount, "Amount should be equal to reward amount");
            expect(userInfo.unlocked).to.equal(0n, "User unlocked amount should be 0");
            expect(userInfo.withdrawn).to.equal(0n, "User withdrawn amount should be 0");

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

            const userJettonBalanceBefore = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);

            let encodedArguments = abiCoder.encode(["tuple(uint256,bytes32[])"], [[reward.rewardAmount, proof]]);
            await sendMessageToTacVesting(senders[i], "chooseImmediateWithdraw", encodedArguments, true);

            const immediateWithdrawAmount = (reward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

            // check ton user balance
            const userJettonBalanceAfter = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
            expect(userJettonBalanceAfter).to.equal(userJettonBalanceBefore + immediateWithdrawAmount, "User jetton balance should be increased by withdrawn amount");

            withdraws[userAddress] = immediateWithdrawAmount;

            const userInfo = await tacVesting.info(userAddress);
            expect(userInfo.stakingAccount).to.equal(ethers.ZeroAddress, "Staking account should not be created");
            expect(userInfo.userTotalRewards).to.equal(reward.rewardAmount, "Amount should be equal to reward amount");
            expect(userInfo.unlocked).to.equal(immediateWithdrawAmount, "User unlocked amount should be equal to immediate withdraw amount");
            expect(userInfo.withdrawn).to.equal(immediateWithdrawAmount, "User withdrawn amount should be equal to immediate withdraw amount");

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
        // check users can claim rewards
        for (let i = 0; i < usersCount; i++) {

            const userReward = rewards[i];
            const userAddress = userReward.userTVMAddress;

            const userInfo = await tacVesting.info(userAddress);
            const userChoiceTime = userInfo.choiceStartTime;
            console.log(`User ${i + 1}/${usersCount}: ${userAddress}`);
            // wait for step duration
            const userChoiceTimeStep = userChoiceTime + step * BigInt(localConfig.stepDuration);
            const startTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            if (startTimestamp < userChoiceTimeStep) {
                console.log(`Waiting for step ${step} duration: ${userChoiceTimeStep - startTimestamp} seconds...`);
                while(1) {
                    const currentTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
                    if (currentTimestamp > userChoiceTimeStep) {
                        break; // step duration reached
                    }
                    // consume gas for generating rewards
                    let tx = await gasConsumer.connect(validator).consumeGas(300, {gasLimit: 25000000});
                    let res = await tx.wait();
                }
            }
            console.log(`Step ${step} passed...`);

            // if choosen staking
            if (userInfo.stakingAccount !== ethers.ZeroAddress) {
                // try to claim rewards

                let userJettonBalanceBefore = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
                console.log(`User jetton balance before claiming: ${ethers.formatEther(userJettonBalanceBefore)} TAC`);
                let encodedParameters = "0x";
                await sendMessageToTacVesting(senders[i], "claimDelegatorRewards", encodedParameters, true);

                let userJettonBalanceAfter = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
                console.log(`User jetton balance after claiming: ${ethers.formatEther(userJettonBalanceAfter)} TAC`);

                console.log(`Rewards received: ${ethers.formatEther(userJettonBalanceAfter - userJettonBalanceBefore )} TAC`);
                const stakingAccountBalance = await deployer.provider!.getBalance(userInfo.stakingAccount);
                console.log(`Staking account balance: ${ethers.formatEther(stakingAccountBalance)} TAC`);
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
                encodedParameters = abiCoder.encode(["uint256"], [availableToUndelegate]);
                const txReceipt = await sendMessageToTacVesting(senders[i], "undelegate", encodedParameters, false);

                let eventFound = false;
                for (const log of txReceipt.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === "Undelegated") {
                        const typedEvent = event as unknown as UndelegatedEvent.LogDescription;
                        expect(typedEvent.args.userTVMAddress).to.equal(userAddress, "User address should match");
                        expect(typedEvent.args.amount).to.equal(availableToUndelegate, "Undelegated amount should match");
                        if (!undelegations[userAddress]) {
                            undelegations[userAddress] = [];
                        }
                        undelegations[userAddress].push({
                            done: false,
                            amount: availableToUndelegate,
                            completionTime: typedEvent.args.completionTime,
                        });
                        eventFound = true;
                    }
                }
                expect(eventFound, "Undelegated event should be emitted").to.be.true;

                withdraws[userAddress] += availableToUndelegate;
                const stakingAccountBalanceAfter = await deployer.provider!.getBalance(userInfo.stakingAccount);
                console.log(`Staking account balance after undelegation: ${ethers.formatEther(stakingAccountBalanceAfter)} TAC`);
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
                const userJettonBalanceBefore = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);

                let encodedParameters = abiCoder.encode(["uint256"], [availableToWithdraw]);
                await sendMessageToTacVesting(senders[i], "withdraw", encodedParameters, true);

                const userJettonBalanceAfter = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
                console.log(`Withdrawn amount: ${ethers.formatEther(userJettonBalanceAfter - userJettonBalanceBefore)} TAC`);

                withdraws[userAddress] += availableToWithdraw;
            }
        }
    }

    // try receive rewards for unbonding delegations
    console.log("Trying to receive delegator rewards for unbonding delegations...");
    for (let i = 0; i < usersCount; i++) {
        const userReward = rewards[i];
        const userAddress = userReward.userTVMAddress;
        const userInfo = await tacVesting.info(userAddress);
        if (userInfo.stakingAccount === ethers.ZeroAddress) {
            continue; // no staking account, skip
        }

        console.log(`User ${i + 1}/${usersCount}: ${userAddress}`);

        // try receive rewards
        try {
            const encodedParameters = "0x";
            await sendMessageToTacVesting(senders[i], "claimDelegatorRewards", encodedParameters, true);
        } catch (error) {
            console.log(`Error while claiming delegator rewards:`, error);
        }
    }

    // try receive undelegated funds
    while (true) {
        let allDone = true;
        for (let i = 0; i < usersCount; i++) {
            const currBlockTimestamp = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
            const userReward = rewards[i];
            const userAddress = userReward.userTVMAddress;
            const userInfo = await tacVesting.info(userAddress);

            if (!undelegations[userAddress]) {
                continue; // no undelegations for this user
            }

            console.log(`Checking undelegations for user ${userAddress}`);

            for (let undelegation of undelegations[userAddress]) {
                console.log(`Undelegation: done ${undelegation.done}, amount ${ethers.formatEther(undelegation.amount)}, completion time ${undelegation.completionTime}, curr block timestamp ${currBlockTimestamp}`);
                if (undelegation.done) {
                    continue; // already done
                }

                // check if undelegation is completed (+20s)
                if (currBlockTimestamp < undelegation.completionTime + 20n) {
                    continue; // not completed yet
                }

                console.log(`User ${i + 1}/${usersCount} ${userAddress} has undelegated funds to receive: ${ethers.formatEther(undelegation.amount)} TAC`);
                const stakingAccountBalance = await deployer.provider!.getBalance(userInfo.stakingAccount);
                console.log(`Staking account(${userInfo.stakingAccount}) balance: ${ethers.formatEther(stakingAccountBalance)} TAC`);

                if (stakingAccountBalance !== 0n) {
                    // try receive undelegated funds
                    const userJettonBalanceBefore = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);

                    const encodedParameters = "0x";
                    await sendMessageToTacVesting(senders[i], "withdrawFromAccount", encodedParameters, true);

                    const userJettonBalanceAfter = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
                    console.log(`Received undelegated amount: ${ethers.formatEther(userJettonBalanceAfter - userJettonBalanceBefore)} TAC`);
                }

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
    let usersJettonBalanceAfter = 0n;
    for (let i = 0; i < usersCount; i++) {
        const userAddress = rewards[i].userTVMAddress;
        const userInfo = await tacVesting.info(userAddress);
        const stakingAccountBalance = await deployer.provider!.getBalance(userInfo.stakingAccount);

        console.log(`User ${i + 1}/${usersCount}: ${userAddress} staking account balance: ${stakingAccountBalance} TAC`);
        const userJettonBalance = await tacSdk.getUserJettonBalance(userAddress, tacJettonAddress);
        usersJettonBalanceAfter += userJettonBalance;
    }

    console.log(`TacVesting contract balance: ${tacVestingBalance} TAC`);
    console.log(`Total rewards: ${totalRewards} TAC`);
    console.log(`Users jetton balance changes: ${ethers.formatEther(usersJettonBalanceAfter - usersJettonBalanceBefore)} TAC`);
}

main();