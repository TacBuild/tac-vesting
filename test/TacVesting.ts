import { ethers } from 'hardhat';
import { expect, use } from 'chai';
import { setBalance } from '@nomicfoundation/hardhat-network-helpers';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';
import { Provider, Signer } from 'ethers';

import { DistributionMock, StakingMock, TacVestingTest } from '../typechain-types';
import { RewardsConfig } from '../scripts/utils/rewards';
import { createLeaf, createRewardsMerkleTree } from '../scripts/utils/rewards';
import MerkleTree from 'merkletreejs';
import { increase, latest } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time';

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
    let users: Signer[];
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

    let receiverAddress: string;
    let rewardsReceiverAddress: string;

    // users withdraw/undelegation info
    let usersWithdraw: {
        [key: string]: {
            withdrawn: bigint;
        }
    }

    before(async function () {

        [admin] = await ethers.getSigners();

        // deploy StakingMock
        const StakingMock = await ethers.getContractFactory('StakingMock');
        stakingMock = await StakingMock.deploy();
        await stakingMock.waitForDeployment();
        // deploy DistributionMock
        const DistributionMock = await ethers.getContractFactory('DistributionMock');
        distributionMock = await DistributionMock.deploy(stakingMock.getAddress());
        await distributionMock.waitForDeployment();

        await setBalance(await distributionMock.getAddress(), ethers.parseEther("100000000000000000"));

        // deploy TacVestingTest
        const TacVesting = await ethers.getContractFactory('TacVestingTest');
        tacVesting = await TacVesting.deploy();
        await tacVesting.waitForDeployment();

        // init
        let tx = await tacVesting.initialize(
            admin.getAddress(), // admin address
            stakingMock.getAddress(), // stacking contract address
            distributionMock.getAddress(), // distribution contract address
            3600n * 24n * 30n // step duration in seconds (30 days)
        );
        await tx.wait();

        VESTING_STEPS = await tacVesting.VESTING_STEPS();
        BASIS_POINTS = await tacVesting.BASIS_POINTS();
        IMMEDIATE_PCT = await tacVesting.IMMEDIATE_PCT();
        COMPLETION_TIMEOUT = await stakingMock.COMPLETION_TIMEOUT();

        usersWithdraw = {};

        const receiver = ethers.Wallet.createRandom(admin.provider);
        receiverAddress = await receiver.getAddress();

        const rewardsReceiver = ethers.Wallet.createRandom(admin.provider);
        rewardsReceiverAddress = await rewardsReceiver.getAddress();
    });

    it('Generate user rewards', async function () {
        const rewardBase = ethers.parseEther("1000");

        users = [];

        userRewards = [];

        totalRewards = 0n;

        for (let i = 0; i < usersCount; i++) {
            const user = await generateSigner(ethers.provider);
            users.push(user);

            const rewardAmount = rewardBase * BigInt(Math.floor(Math.random() * 10 + 1));
            userRewards.push({
                userAddress: await user.getAddress(),
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
            const user = users[i];
            const userAddress = await user.getAddress();
            const userReward = userRewards[i];

            const leaf = createLeaf(userReward);
            const proof = merkleTree.getHexProof(leaf);

            const choice = Math.round(Math.random());

            let tx;
            const vestingBalanceBefore = await admin.provider.getBalance(tacVesting.getAddress());
            if (choice === 0) { // user choose staking
                const stakingBalanceBefore = await admin.provider.getBalance(stakingMock.getAddress());
                tx = await tacVesting.connect(user).chooseStaking(
                    validatorAddress,
                    userReward.rewardAmount,
                    proof
                );
                await expect(tx).to.emit(tacVesting, 'Delegated').withArgs(userAddress, validatorAddress, userReward.rewardAmount);

                usersWithdraw[userAddress] = {
                    withdrawn: 0n
                };

                const userInfo = await tacVesting.info(userAddress);

                expect(userInfo.stakingAccount).to.not.equal(ethers.ZeroAddress);
                expect(userInfo.choiceStartTime).to.eq(await latest());

                const stakingAccountAddress = userInfo.stakingAccount;

                const vestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
                const stakingBalanceAfter = await admin.provider.getBalance(stakingMock.getAddress());

                expect(vestingBalanceAfter).to.equal(vestingBalanceBefore - userReward.rewardAmount);
                expect(stakingBalanceAfter).to.equal(stakingBalanceBefore + userReward.rewardAmount);

                const delegation = await stakingMock.getDelegation(stakingAccountAddress, validatorAddress);
                expect(delegation.amount).to.equal(userReward.rewardAmount);

                // check user can't choose again
                await expect(tacVesting.connect(user).chooseStaking(validatorAddress, userReward.rewardAmount, proof))
                    .to.be.revertedWith('TacVesting: User already made a choice');
                await expect(tacVesting.connect(user).chooseImmediateWithdraw(receiverAddress, userReward.rewardAmount, proof))
                    .to.be.revertedWith('TacVesting: User already made a choice');

            } else { // user choose immediate withdraw
                const receiverBalanceBefore = await admin.provider.getBalance(receiverAddress);
                tx = await tacVesting.connect(user).chooseImmediateWithdraw(
                    receiverAddress,
                    userReward.rewardAmount,
                    proof
                );

                const immediateWithdrawAmount = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;

                await expect(tx).to.emit(tacVesting, 'Withdrawn').withArgs(userAddress, receiverAddress, immediateWithdrawAmount);

                const userInfo = await tacVesting.info(userAddress);
                expect(userInfo.stakingAccount).to.equal(ethers.ZeroAddress);
                expect(userInfo.choiceStartTime).to.eq(await latest());

                const vestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
                const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);

                expect(vestingBalanceAfter).to.equal(vestingBalanceBefore - immediateWithdrawAmount);
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + immediateWithdrawAmount);

                usersWithdraw[userAddress] = {
                    withdrawn: immediateWithdrawAmount
                };

                // check user can't choose again
                await expect(tacVesting.connect(user).chooseStaking(validatorAddress, userReward.rewardAmount, proof))
                    .to.be.revertedWith('TacVesting: User already made a choice');
                await expect(tacVesting.connect(user).chooseImmediateWithdraw(receiverAddress, userReward.rewardAmount, proof))
                    .to.be.revertedWith('TacVesting: User already made a choice');
            }
        }
    });

    it('Check unlocking and claiming', async function () {
        // check that users cant undelegate, withdraw and claim delegator rewards before the first step
        for (let i = 0; i < usersCount; i++) {
            const user = users[i];
            const userAddress = await user.getAddress();
            const userInfo = await tacVesting.info(userAddress);

            if (userInfo.stakingAccount !== ethers.ZeroAddress) { // user chose staking
                await expect(tacVesting.connect(user).undelegate(validatorAddress, 1n)).to.be.revertedWith('TacVesting: No available funds to undelegate');
                await expect(tacVesting.connect(user).claimDelegatorRewards(receiverAddress, validatorAddress)).to.be.revertedWith('TacVesting: Cannot claim rewards before the first step is completed');
            } else {
                // user chose immediate withdraw
                await expect(tacVesting.connect(user).withdraw(receiverAddress, 1n)).to.be.revertedWith('TacVesting: No available funds to withdraw');
            }
        }

        for (let step = 1n; step <= VESTING_STEPS; step++) {

            await increase(3600n * 24n * 30n); // increase time by 30 days

            for (let i = 0; i < usersCount; i++) {
                const user = users[i];
                const userAddress = await user.getAddress();
                const userReward = userRewards[i];

                let userInfo = await tacVesting.info(userAddress);

                const doSomething = Math.round(Math.random());

                if (doSomething === 0) continue; // skip some users

                if (userInfo.stakingAccount !== ethers.ZeroAddress) { // user chose staking
                    // 1 / VESTING_STEPS of the reward should be unlocked
                    let expectedUnlockAmount;
                    if (step === VESTING_STEPS) {
                        expectedUnlockAmount = userReward.rewardAmount; // last step, all should be unlocked
                    } else {
                        expectedUnlockAmount = (userReward.rewardAmount * step / VESTING_STEPS);
                    }
                    const unlockedAmount = await tacVesting.getUnlocked(userAddress);
                    expect(unlockedAmount).to.equal(expectedUnlockAmount);

                    const availableToUndelegate = await tacVesting.getAvailable(userAddress);
                    const expectedUnlockAmountForUndelegate = expectedUnlockAmount - usersWithdraw[userAddress].withdrawn;
                    expect(availableToUndelegate).to.equal(expectedUnlockAmountForUndelegate);

                    // withdraw must failed for staking choice
                    await expect(tacVesting.connect(user).withdraw(receiverAddress, 1n)).to.be.revertedWith('TacVesting: User has not chosen immediate withdraw');

                    // undelegate must failed for trying to undelegate more than available
                    await expect(tacVesting.connect(user).undelegate(validatorAddress, availableToUndelegate + 1n))
                        .to.be.revertedWith('TacVesting: No available funds to undelegate');
                    // check that user cant withdraw funds (for immediate withdraw choice)
                    await expect(tacVesting.connect(user).withdraw(receiverAddress, availableToUndelegate))
                        .to.be.revertedWith('TacVesting: User has not chosen immediate withdraw');

                    // check that user can undelegate
                    const delegationBefore = await stakingMock.getDelegation(userInfo.stakingAccount, validatorAddress);

                    const undelegateAmount = availableToUndelegate / 10n ** BigInt(Math.round(Math.random() * 3));
                    let tx = await tacVesting.connect(user).undelegate(validatorAddress, undelegateAmount);
                    await expect(tx).to.emit(tacVesting, 'Undelegated').withArgs(userAddress, validatorAddress, undelegateAmount, BigInt(await latest()) + COMPLETION_TIMEOUT);
                    const undelegationTime = await latest();
                    usersWithdraw[userAddress].withdrawn += undelegateAmount;

                    userInfo = await tacVesting.info(userAddress);
                    expect(userInfo.withdrawn).to.equal(usersWithdraw[userAddress].withdrawn);

                    const delegationAfter = await stakingMock.getDelegation(userInfo.stakingAccount, validatorAddress);
                    expect(delegationAfter.amount).to.equal(delegationBefore.amount - undelegateAmount);

                    const undelegation = await stakingMock.getUndelegation(userInfo.stakingAccount, undelegationTime);
                    expect(undelegation.amount).to.equal(undelegateAmount);

                    // check that user can claim delegator rewards
                    tx = await tacVesting.connect(user).claimDelegatorRewards(rewardsReceiverAddress, validatorAddress);
                    await expect(tx).to.emit(tacVesting, 'RewardsClaimed').withArgs(userAddress, rewardsReceiverAddress, validatorAddress);

                    // wait for completion timeout
                    await increase(COMPLETION_TIMEOUT);
                    tx =  await stakingMock.sendUndelegated(userInfo.stakingAccount, undelegationTime);
                    await tx.wait();

                    expect(await admin.provider.getBalance(userInfo.stakingAccount)).to.equal(undelegateAmount);

                    // check that user cant recieve more than undelegated amount
                    const stakingAccountContract = await ethers.getContractAt('StakingAccount', userInfo.stakingAccount, user);
                    await expect(tacVesting.connect(user).withdrawUndelegated(receiverAddress, undelegateAmount + 1n))
                        .to.be.revertedWithCustomError(stakingAccountContract, "InsufficientBalance").withArgs(undelegateAmount, undelegateAmount + 1n);

                    // check that user can withdraw undelegated funds
                    const receiverBalanceBefore = await admin.provider.getBalance(receiverAddress);
                    tx = await tacVesting.connect(user).withdrawUndelegated(receiverAddress, undelegateAmount);
                    await expect(tx).to.emit(tacVesting, 'WithdrawnUndelegated').withArgs(userAddress, receiverAddress, undelegateAmount);
                    const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);
                    expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + undelegateAmount);
                } else { // user chose immediate withdraw
                    const firstTransfer = (userReward.rewardAmount * IMMEDIATE_PCT) / BASIS_POINTS;
                    // (total - firstTransfer) / VESTING_STEPS should be unlocked
                    const stepUnlockAmount = (userReward.rewardAmount - firstTransfer) / VESTING_STEPS;

                    let expectedUnlockAmount;
                    if (step === VESTING_STEPS) {
                        expectedUnlockAmount = userReward.rewardAmount; // last step, all should be unlocked
                    } else {
                        expectedUnlockAmount = firstTransfer + stepUnlockAmount * step;
                    }

                    const unlockedAmount = await tacVesting.getUnlocked(userAddress);
                    expect(unlockedAmount).to.equal(expectedUnlockAmount);

                    const availableToWithdraw = await tacVesting.getAvailable(userAddress);
                    const expectedAvailableToWithdraw = expectedUnlockAmount - usersWithdraw[userAddress].withdrawn;

                    expect(availableToWithdraw).to.equal(expectedAvailableToWithdraw);

                    // check that user can't undelegate (for staking choice)
                    await expect(tacVesting.connect(user).undelegate(validatorAddress, 1n))
                        .to.be.revertedWith('TacVesting: User has not chosen staking');

                    // check that user cant withdraw more than available
                    await expect(tacVesting.connect(user).withdraw(receiverAddress, availableToWithdraw + 1n))
                        .to.be.revertedWith('TacVesting: No available funds to withdraw');

                    // check that user can withdraw available amount
                    const toWithdraw = availableToWithdraw / 10n ** BigInt(Math.round(Math.random() * 3));

                    const receiverBalanceBefore = await admin.provider.getBalance(receiverAddress);
                    let tx = await tacVesting.connect(user).withdraw(receiverAddress, toWithdraw);
                    await expect(tx).to.emit(tacVesting, 'Withdrawn').withArgs(userAddress, receiverAddress, toWithdraw);

                    const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);
                    expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + toWithdraw);

                    usersWithdraw[userAddress].withdrawn += toWithdraw;
                }
            }
        }

        // after all steps completed, users should be able to withdraw/undelegate all their funds
        for (let i = 0; i < usersCount; i++) {
            const user = users[i];
            const userAddress = await user.getAddress();
            const userReward = userRewards[i];

            let userInfo = await tacVesting.info(userAddress);

            if (userInfo.stakingAccount !== ethers.ZeroAddress) { // user chose staking
                // check that user can undelegate all available funds
                const availableToUndelegate = await tacVesting.getAvailable(userAddress);
                if (availableToUndelegate === 0n) {
                    continue; // no available funds to undelegate
                }
                expect(availableToUndelegate).to.equal(userReward.rewardAmount - usersWithdraw[userAddress].withdrawn);

                let tx = await tacVesting.connect(user).undelegate(validatorAddress, availableToUndelegate);
                await expect(tx).to.emit(tacVesting, 'Undelegated').withArgs(userAddress, validatorAddress, availableToUndelegate, BigInt(await latest()) + COMPLETION_TIMEOUT);
                const undelegationTime = await latest();

                usersWithdraw[userAddress].withdrawn += availableToUndelegate;

                // wait for completion timeout
                await increase(COMPLETION_TIMEOUT);

                tx =  await stakingMock.sendUndelegated(userInfo.stakingAccount, undelegationTime);
                await tx.wait();

                // check that user can withdraw undelegated funds
                const receiverBalanceBefore = await admin.provider.getBalance(receiverAddress);
                tx = await tacVesting.connect(user).withdrawUndelegated(receiverAddress, availableToUndelegate);
                await expect(tx).to.emit(tacVesting, 'WithdrawnUndelegated').withArgs(userAddress, receiverAddress, availableToUndelegate);
                const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + availableToUndelegate);

            } else { // user chose immediate withdraw
                // check that user can withdraw all remaining funds
                const toWithdraw = (userReward.rewardAmount - usersWithdraw[userAddress].withdrawn);
                const receiverBalanceBefore = await admin.provider.getBalance(receiverAddress);
                let tx = await tacVesting.connect(user).withdraw(receiverAddress, toWithdraw);
                await expect(tx).to.emit(tacVesting, 'Withdrawn').withArgs(userAddress, receiverAddress, toWithdraw);

                const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);
                expect(receiverBalanceAfter).to.equal(receiverBalanceBefore + toWithdraw);

                usersWithdraw[userAddress].withdrawn += toWithdraw;
            }

            userInfo = await tacVesting.info(userAddress);
            expect(userInfo.unlocked).to.equal(userReward.rewardAmount);
            expect(userInfo.withdrawn).to.equal(userReward.rewardAmount);

            const available = await tacVesting.getAvailable(userAddress);

            expect(available).to.equal(0n);

            // expect(await admin.provider.getBalance(tacVesting.getAddress())).to.equal(0n);
        }

        const receiverBalanceAfter = await admin.provider.getBalance(receiverAddress);
        const tacVestingBalanceAfter = await admin.provider.getBalance(tacVesting.getAddress());
        const stackingMockBalanceAfter = await admin.provider.getBalance(stakingMock.getAddress());

        expect(tacVestingBalanceAfter).to.equal(0n);
        expect(stackingMockBalanceAfter).to.equal(0n);
        expect(receiverBalanceAfter).to.equal(totalRewards);

    });
});

