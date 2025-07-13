import hre, { ethers } from 'hardhat';
import { expect } from 'chai';
import { anyValue } from '@nomicfoundation/hardhat-chai-matchers/withArgs';
import { setBalance, setCode } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Provider, Signer } from 'ethers';

import { DistributionMock, StakingMock, TacVestingTest } from '../typechain-types';
import { RewardsConfig } from '../scripts/utils/rewards';
import { createLeaf, createRewardsMerkleTree } from '../scripts/utils/rewards';
import MerkleTree from 'merkletreejs';
import { increase, latest } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time';
import { DistributionPrecompileAddress, StakingPrecompileAddress, testnetConfig } from '../scripts/config/config';

import StakingMockArtifact from '../artifacts/contracts/mock/StakingMock.sol/StakingMock.json';
import DistributionMockArtifact from '../artifacts/contracts/mock/DistributionMock.sol/DistributionMock.json';
import { deploy, deployUpgradable, deployUpgradableLocal, SendMessageOutput, TacLocalTestSdk } from '@tonappchain/evm-ccl';
import { DelegatedEvent, RewardsClaimedEvent, UndelegatedEvent, WithdrawnEvent, WithdrawnFromAccountEvent } from '../typechain-types/contracts/TacVesting';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

export async function generateSigner(provider: Provider): Promise<Signer> {
    const signer = ethers.Wallet.createRandom(provider);
    await setBalance(signer.address, ethers.parseEther("100"));

    return signer;
}

describe('TacVesting', function () {
    let admin: HardhatEthersSigner;
    let tacVesting: TacVestingTest;
    let stakingMock: StakingMock;
    let distributionMock: DistributionMock;
    let userRewards: RewardsConfig[];
    let totalRewards: bigint;

    let merkleTree: MerkleTree;

    // random number of users between 30 and 100
    const usersCount: number = Math.floor(Math.random() * 100 + 30);

    const validatorAddress = "ValidatorAddress";

    let BASIS_POINTS: bigint;
    let IMMEDIATE_PCT: bigint;
    let VESTING_STEPS: bigint;
    let COMPLETION_TIMEOUT: bigint;

    // users withdraw/undelegation info
    let usersWithdraw: {
        [key: string]: bigint;
    }

    let availableToAdminWithdraw: bigint = 0n;

    let testSdk: TacLocalTestSdk;

    const stepDuration = 3600n * 24n * 30n; // 30 days in seconds

    async function sendMessage(tvmCaller: string, methodName: string, encodedArguments: string): Promise<SendMessageOutput> {
        const shardsKey = BigInt(randInt(0, 10000));
        const operationId = ethers.encodeBytes32String(`operation-${shardsKey}`);
        const target = await tacVesting.getAddress();

        return await testSdk.sendMessage(
            shardsKey,
            target,
            methodName,
            encodedArguments,
            tvmCaller,
            [],
            [],
            0n,
            "0x",
            operationId
        );

    }

    before(async function () {

        [admin] = await ethers.getSigners();

        testSdk = new TacLocalTestSdk();
        let crossChainLayerAddress = await testSdk.create(ethers.provider);
        let saFactoryAddress = testSdk.getSmartAccountFactoryAddress();

        // deploy StakingMock to precompile address
        // set code to address using hardhat network helpers
        await setCode(StakingPrecompileAddress, StakingMockArtifact.deployedBytecode);
        stakingMock = await ethers.getContractAt('StakingMock', StakingPrecompileAddress);
        // deploy DistributionMock to precompile address
        // set code to address using hardhat network helpers
        await setCode(DistributionPrecompileAddress, DistributionMockArtifact.deployedBytecode);
        distributionMock = await ethers.getContractAt('DistributionMock', DistributionPrecompileAddress);

        await setBalance(await distributionMock.getAddress(), ethers.parseEther("100000000000000000"));

        // deploy TacVestingTest
        tacVesting = await deployUpgradable<TacVestingTest>(
            admin as unknown as Signer,
            hre.artifacts.readArtifactSync("TacVestingTest"),
            [
                crossChainLayerAddress, // cross chain layer address
                saFactoryAddress, // sa factory address
                await admin.getAddress(), // admin address
                stepDuration, // step duration in seconds
            ],
            {
                kind: "uups",
                unsafeAllow: ["missing-initializer"]
            },
            undefined,
            true
        );

        VESTING_STEPS = await tacVesting.VESTING_STEPS();
        BASIS_POINTS = await tacVesting.BASIS_POINTS();
        IMMEDIATE_PCT = await tacVesting.IMMEDIATE_PCT();
        COMPLETION_TIMEOUT = await stakingMock.COMPLETION_TIMEOUT();

        usersWithdraw = {};

    });

    it('Generate user rewards', async function () {
        const rewardBase = ethers.parseEther("1000");

        userRewards = [];

        totalRewards = 0n;

        for (let i = 0; i < usersCount; i++) {
            const rewardAmount = rewardBase * BigInt(Math.floor(Math.random() * 10 + 1));
            userRewards.push({
                userTVMAddress: `UserTVMAddress-${i}`,
                rewardAmount: rewardAmount
            });
            totalRewards += rewardAmount;
        }

        // Set balance for admin to cover rewards
        setBalance(admin.address, totalRewards + ethers.parseEther("100"));

        // send rewards to TacVesting contract
        let tx = await admin.sendTransaction({
            to: tacVesting.getAddress(),
            value: totalRewards
        });
        await tx.wait();

        expect(await ethers.provider.getBalance(tacVesting.getAddress())).to.equal(totalRewards);
    });

    it('Build rewards Merkle Tree, setup root', async function () {
        merkleTree = createRewardsMerkleTree(userRewards);

        const root = merkleTree.getHexRoot();

        let tx = await tacVesting.setMerkleRoot(root);
        await tx.wait();

        expect(await tacVesting.merkleRoot()).to.equal(root);
    });

    // start test
    it('Make users choice', async function () {
        for (let i = 0; i < usersCount; i++) {
            const userReward = userRewards[i];

            const leaf = createLeaf(userReward);
            const proof = merkleTree.getHexProof(leaf);

            // const choiceStaking = Math.round(Math.random()) === 0 ? true : false;
            const choiceStaking = true; // for now, we will always choose staking

            let tx;
            const vestingBalanceBefore = await admin.provider.getBalance(tacVesting.getAddress());
            if (choiceStaking) { // user choose staking
                const stakingBalanceBefore = await admin.provider.getBalance(stakingMock.getAddress());

                // encode ChooseStakingParams
                let encodedArguments = abiCoder.encode(["tuple(string,uint256,bytes32[])"], [[validatorAddress, userReward.rewardAmount, proof]]);
                const output = await sendMessage(userReward.userTVMAddress, 'chooseStaking(bytes,bytes)', encodedArguments);
                // no out messages expected
                expect(output.outMessages.length).to.be.equal(0);

                let eventFound = false;
                for (const log of output.receipt.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === 'Delegated') {
                        const typedEvent = event as unknown as DelegatedEvent.LogDescription;
                        expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                        expect(typedEvent.args.validatorAddress).to.equal(validatorAddress);
                        expect(typedEvent.args.amount).to.equal(userReward.rewardAmount);
                        eventFound = true;
                    }
                }
                expect(eventFound).to.be.true;

                usersWithdraw[userReward.userTVMAddress] = 0n;

                const userInfo = await tacVesting.info(userReward.userTVMAddress);

                expect(userInfo.smartAccount).to.not.equal(ethers.ZeroAddress);
                expect(userInfo.choiceStartTime).to.eq(await latest());

                const stakingAccountAddress = userInfo.smartAccount;

                const vestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
                const stakingBalanceAfter = await admin.provider.getBalance(stakingMock.getAddress());

                expect(vestingBalanceAfter).to.equal(vestingBalanceBefore - userReward.rewardAmount);
                expect(stakingBalanceAfter).to.equal(stakingBalanceBefore + userReward.rewardAmount);

                const delegation = await stakingMock.getDelegation(stakingAccountAddress, validatorAddress);
                expect(delegation.amount).to.equal(userReward.rewardAmount);

                // check user can't choose again
                encodedArguments = abiCoder.encode(["tuple(string,uint256,bytes32[])"], [[validatorAddress, userReward.rewardAmount, proof]]);
                let catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'chooseStaking(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: User already made a choice');
                }
                expect(catchedError).to.be.true;

                // check user can't choose immediate withdraw
                encodedArguments = abiCoder.encode(["tuple(uint256,bytes32[])"], [[userReward.rewardAmount, proof]]);
                catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'chooseImmediateWithdraw(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: User already made a choice');
                }
                expect(catchedError).to.be.true;

            } else { // user choose immediate withdraw
                const cclBalanceBefore = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());

                // encode ChooseImmediateWithdrawParams
                let encodedArguments = abiCoder.encode(["tuple(uint256,bytes32[])"], [[userReward.rewardAmount, proof]]);

                const output = await sendMessage(userReward.userTVMAddress, 'chooseImmediateWithdraw(bytes,bytes)', encodedArguments);

                const immediateWithdrawAmount = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

                let eventFound = false;

                for (const log of output.receipt.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === 'Withdrawn') {
                        const typedEvent = event as unknown as WithdrawnEvent.LogDescription;
                        expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                        expect(typedEvent.args.amount).to.equal(immediateWithdrawAmount);
                        eventFound = true;
                    }
                }
                expect(eventFound).to.be.true;

                // expect one out message to be sent to ton
                expect(output.outMessages.length).to.be.equal(1);
                const outMessage = output.outMessages[0];
                expect(outMessage.targetAddress).to.equal(userReward.userTVMAddress);
                // check that tac native was locked
                expect(outMessage.tokensLocked.length).to.equal(1);
                expect(outMessage.tokensLocked[0].evmAddress).to.equal(testSdk.getNativeTokenAddress());
                expect(outMessage.tokensLocked[0].amount).to.equal(immediateWithdrawAmount);


                const userInfo = await tacVesting.info(userReward.userTVMAddress);
                expect(userInfo.smartAccount).to.equal(ethers.ZeroAddress);
                expect(userInfo.choiceStartTime).to.eq(await latest());

                const vestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
                const cclBalanceAfter = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());

                expect(vestingBalanceAfter).to.equal(vestingBalanceBefore - immediateWithdrawAmount);
                expect(cclBalanceAfter).to.equal(cclBalanceBefore + immediateWithdrawAmount);

                usersWithdraw[userReward.userTVMAddress] = immediateWithdrawAmount;

                // check user can't choose again
                encodedArguments = abiCoder.encode(["tuple(uint256,bytes32[])"], [[userReward.rewardAmount, proof]]);
                let catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'chooseImmediateWithdraw(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: User already made a choice');
                }
                expect(catchedError).to.be.true;

                // check user can't choose staking
                encodedArguments = abiCoder.encode(["tuple(string,uint256,bytes32[])"], [[validatorAddress, userReward.rewardAmount, proof]]);
                catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'chooseStaking(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: User already made a choice');
                }
                expect(catchedError).to.be.true;

                availableToAdminWithdraw += userReward.rewardAmount - immediateWithdrawAmount;
            }
        }
    });

    it('Check unlocking and claiming', async function () {
        // check that users cant undelegate, withdraw and claim delegator rewards before the first step
        for (let i = 0; i < usersCount; i++) {

            const userReward = userRewards[i];

            const userInfo = await tacVesting.info(userReward.userTVMAddress);

            if (userInfo.smartAccount !== ethers.ZeroAddress) { // user chose staking
                // check that user can't undelegate
                let encodedArguments = abiCoder.encode(["uint256"], [1n]);
                let catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'undelegate(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: No available funds to undelegate');
                }
                expect(catchedError).to.be.true;

                // check that user can't claim delegator rewards
                encodedArguments = "0x"; // no arguments for claimDelegatorRewards
                catchedError = false;
                try {
                    await sendMessage(userReward.userTVMAddress, 'claimDelegatorRewards(bytes,bytes)', encodedArguments);
                } catch (error: any) {
                    catchedError = error.message.includes('TacVesting: Cannot claim rewards before the first step is completed');
                }
            } else { // user chose immediate withdraw
            }
        }

        for (let step = 1n; step <= VESTING_STEPS; step++) {

            await increase(stepDuration); // increase time by 30 days

            for (let i = 0; i < usersCount; i++) {
                const userReward = userRewards[i];

                let userInfo = await tacVesting.info(userReward.userTVMAddress);

                const doSomething = Math.round(Math.random()) === 0 ? true : false; // randomly skip some users

                if (doSomething) continue; // skip some users

                if (userInfo.smartAccount !== ethers.ZeroAddress) { // user chose staking
                    // 1 / VESTING_STEPS of the reward should be unlocked
                    let expectedUnlockAmount;
                    if (step === VESTING_STEPS) {
                        expectedUnlockAmount = userReward.rewardAmount; // last step, all should be unlocked
                    } else {
                        expectedUnlockAmount = (userReward.rewardAmount * step / VESTING_STEPS);
                    }
                    const unlockedAmount = await tacVesting.getUnlocked(userReward.userTVMAddress);
                    expect(unlockedAmount).to.equal(expectedUnlockAmount);

                    const availableToUndelegate = await tacVesting.getAvailable(userReward.userTVMAddress);
                    const expectedUnlockAmountForUndelegate = expectedUnlockAmount - usersWithdraw[userReward.userTVMAddress];
                    expect(availableToUndelegate).to.equal(expectedUnlockAmountForUndelegate);

                    // undelegate must failed for trying to undelegate more than available
                    let encodedArguments = abiCoder.encode(["uint256"], [availableToUndelegate + 1n]);
                    let catchedError = false;
                    try {
                        await sendMessage(userReward.userTVMAddress, 'undelegate(bytes,bytes)', encodedArguments);
                    } catch (error: any) {
                        catchedError = error.message.includes('TacVesting: No available funds to undelegate');
                    }
                    expect(catchedError).to.be.true;

                    // check that user can undelegate
                    const delegationBefore = await stakingMock.getDelegation(userInfo.smartAccount, validatorAddress);

                    const undelegateAmount = availableToUndelegate / 10n ** BigInt(Math.round(Math.random() * 3));
                    encodedArguments = abiCoder.encode(["uint256"], [undelegateAmount]);
                    let output = await sendMessage(userReward.userTVMAddress, 'undelegate(bytes,bytes)', encodedArguments);

                    // check that no out messages were sent
                    expect(output.outMessages.length).to.equal(0);

                    // check that event was emitted
                    let eventFound = false;
                    for (const log of output.receipt.logs) {
                        const event = tacVesting.interface.parseLog(log);
                        if (event?.name === 'Undelegated') {
                            const typedEvent = event as unknown as UndelegatedEvent.LogDescription;
                            expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                            expect(typedEvent.args.amount).to.equal(undelegateAmount);
                            expect(typedEvent.args.completionTime).to.equal(BigInt(await latest()) + COMPLETION_TIMEOUT);
                            eventFound = true;
                        }
                    }
                    expect(eventFound).to.be.true;

                    const undelegationTime = await latest();
                    usersWithdraw[userReward.userTVMAddress] += undelegateAmount;

                    userInfo = await tacVesting.info(userReward.userTVMAddress);
                    expect(userInfo.withdrawn).to.equal(usersWithdraw[userReward.userTVMAddress]);

                    const delegationAfter = await stakingMock.getDelegation(userInfo.smartAccount, validatorAddress);
                    expect(delegationAfter.amount).to.equal(delegationBefore.amount - undelegateAmount);

                    const undelegation = await stakingMock.getUndelegation(userInfo.smartAccount, undelegationTime);
                    expect(undelegation.amount).to.equal(undelegateAmount);

                    // check that user can claim delegator rewards
                    encodedArguments = "0x"; // no arguments for claimDelegatorRewards
                    output = await sendMessage(userReward.userTVMAddress, 'claimDelegatorRewards(bytes,bytes)', encodedArguments);

                    eventFound = false;
                    for (const log of output.receipt.logs) {
                        const event = tacVesting.interface.parseLog(log);
                        if (event?.name === 'RewardsClaimed') {
                            const typedEvent = event as unknown as RewardsClaimedEvent.LogDescription;
                            expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                            expect(typedEvent.args.rewardAmount).to.be.gt(0n); // rewards should be greater than 0
                            eventFound = true;
                        }
                    }
                    expect(eventFound).to.be.true;

                    // wait for completion timeout
                    await increase(COMPLETION_TIMEOUT);
                    let tx =  await stakingMock.sendUndelegated(userInfo.smartAccount, undelegationTime);
                    await tx.wait();

                    expect(await admin.provider.getBalance(userInfo.smartAccount)).to.equal(undelegateAmount);

                    // check that user can withdraw undelegated funds
                    const cclBalanceBefore = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());
                    encodedArguments = "0x"; // no arguments for withdrawFromAccount
                    output = await sendMessage(userReward.userTVMAddress, 'withdrawFromAccount(bytes,bytes)', encodedArguments);
                    expect(output.outMessages.length).to.equal(1);
                    const outMessage = output.outMessages[0];
                    expect(outMessage.targetAddress).to.equal(userReward.userTVMAddress);
                    expect(outMessage.tokensLocked.length).to.equal(1);
                    expect(outMessage.tokensLocked[0].evmAddress).to.equal(testSdk.getNativeTokenAddress());
                    expect(outMessage.tokensLocked[0].amount).to.equal(undelegateAmount);

                    eventFound = false;
                    for (const log of output.receipt.logs) {
                        const event = tacVesting.interface.parseLog(log);
                        if (event?.name === 'WithdrawnFromAccount') {
                            const typedEvent = event as unknown as WithdrawnEvent.LogDescription;
                            expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                            expect(typedEvent.args.amount).to.equal(undelegateAmount);
                            eventFound = true;
                        }
                    }
                    expect(eventFound).to.be.true;

                    const cclBalanceAfter = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());
                    expect(cclBalanceAfter).to.equal(cclBalanceBefore + undelegateAmount);
                } else { // user chose immediate withdraw
                    const firstTransfer = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

                    const unlockedAmount = await tacVesting.getUnlocked(userReward.userTVMAddress);
                    expect(unlockedAmount).to.equal(firstTransfer);

                    const availableToWithdraw = await tacVesting.getAvailable(userReward.userTVMAddress);

                    expect(availableToWithdraw).to.equal(0n);

                    // check that user can't undelegate (for staking choice)
                    let encodedArguments = abiCoder.encode(["uint256"], [1n]);
                    let catchedError = false;
                    try {
                        await sendMessage(userReward.userTVMAddress, 'undelegate(bytes,bytes)', encodedArguments);
                    } catch (error: any) {
                        catchedError = error.message.includes('TacVesting: User has not chosen staking');
                    }
                    expect(catchedError).to.be.true;
                }
            }
        }

        // after all steps completed, users should be able to withdraw/undelegate all their funds
        for (let i = 0; i < usersCount; i++) {
            const userReward = userRewards[i];

            let userInfo = await tacVesting.info(userReward.userTVMAddress);

            if (userInfo.smartAccount !== ethers.ZeroAddress) { // user chose staking
                // check that user can undelegate all available funds
                const availableToUndelegate = await tacVesting.getAvailable(userReward.userTVMAddress);
                if (availableToUndelegate === 0n) {
                    continue; // no available funds to undelegate
                }
                expect(availableToUndelegate).to.equal(userReward.rewardAmount - usersWithdraw[userReward.userTVMAddress]);

                let encodedArguments = abiCoder.encode(["uint256"], [availableToUndelegate]);
                let output = await sendMessage(userReward.userTVMAddress, 'undelegate(bytes,bytes)', encodedArguments);
                // check that no out messages were sent
                expect(output.outMessages.length).to.equal(0);

                let eventFound = false;
                for (const log of output.receipt.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === 'Undelegated') {
                        const typedEvent = event as unknown as UndelegatedEvent.LogDescription;
                        expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                        expect(typedEvent.args.amount).to.equal(availableToUndelegate);
                        expect(typedEvent.args.completionTime).to.equal(BigInt(await latest()) + COMPLETION_TIMEOUT);
                        eventFound = true;
                    }
                }
                expect(eventFound).to.be.true;

                const undelegationTime = await latest();

                usersWithdraw[userReward.userTVMAddress] += availableToUndelegate;

                // wait for completion timeout
                await increase(COMPLETION_TIMEOUT);
                let tx =  await stakingMock.sendUndelegated(userInfo.smartAccount, undelegationTime);
                await tx.wait();
                expect(await admin.provider.getBalance(userInfo.smartAccount)).to.equal(availableToUndelegate);

                // check that user can withdraw undelegated funds
                const cclBalanceBefore = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());

                encodedArguments = "0x"; // no arguments for withdrawFromAccount
                output = await sendMessage(userReward.userTVMAddress, 'withdrawFromAccount(bytes,bytes)', encodedArguments);
                // check that one out message was sent
                expect(output.outMessages.length).to.equal(1);
                const outMessage = output.outMessages[0];
                expect(outMessage.targetAddress).to.equal(userReward.userTVMAddress);
                expect(outMessage.tokensLocked.length).to.equal(1);
                expect(outMessage.tokensLocked[0].evmAddress).to.equal(testSdk.getNativeTokenAddress());
                expect(outMessage.tokensLocked[0].amount).to.equal(availableToUndelegate);

                eventFound = false;
                for (const log of output.receipt.logs) {
                    const event = tacVesting.interface.parseLog(log);
                    if (event?.name === 'WithdrawnFromAccount') {
                        const typedEvent = event as unknown as WithdrawnFromAccountEvent.LogDescription;
                        expect(typedEvent.args.userTVMAddress).to.equal(userReward.userTVMAddress);
                        expect(typedEvent.args.amount).to.equal(availableToUndelegate);
                        eventFound = true;
                    }
                }
                expect(eventFound).to.be.true;

                const cclBalanceAfter = await admin.provider.getBalance(testSdk.getCrossChainLayerAddress());
                expect(cclBalanceAfter).to.equal(cclBalanceBefore + availableToUndelegate);

                userInfo = await tacVesting.info(userReward.userTVMAddress);
                expect(userInfo.unlocked).to.equal(userReward.rewardAmount);
                expect(userInfo.withdrawn).to.equal(userReward.rewardAmount);

            } else { // user chose immediate withdraw

                const firstTransfer = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

                userInfo = await tacVesting.info(userReward.userTVMAddress);
                expect(userInfo.unlocked).to.equal(firstTransfer);
                expect(userInfo.withdrawn).to.equal(firstTransfer);
            }
            const available = await tacVesting.getAvailable(userReward.userTVMAddress);

            expect(available).to.equal(0n);

            // expect(await admin.provider.getBalance(tacVesting.getAddress())).to.equal(0n);
        }

        let available = await tacVesting.availableForAdminWithdraw();
        expect(availableToAdminWithdraw).to.equal(available);

        // check admin can withdraw all available funds
        let tx = await tacVesting.adminWithdraw(availableToAdminWithdraw, await admin.getAddress());
        await tx.wait();

        available = await tacVesting.availableForAdminWithdraw();
        expect(available).to.equal(0n);

        const tacVestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
        const stackingMockBalanceAfter = await admin.provider.getBalance(stakingMock.getAddress());

        expect(tacVestingBalanceAfter).to.equal(0n);
    });
});