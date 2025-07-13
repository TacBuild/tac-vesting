import hre, { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';
import { setBalance, setCode } from '@nomicfoundation/hardhat-network-helpers';
import { Provider, Signer } from 'ethers';
import { deployUpgradableLocal, SendMessageOutput, TacLocalTestSdk } from '@tonappchain/evm-ccl';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/signers';

import { DistributionMock, StakingMock, StakingProxyTest } from '../typechain-types';
import { increase, latest } from '@nomicfoundation/hardhat-network-helpers/dist/src/helpers/time';
import { DistributionPrecompileAddress, StakingPrecompileAddress, testnetConfig } from '../scripts/config/config';

import StakingMockArtifact from '../artifacts/contracts/mock/StakingMock.sol/StakingMock.json';
import DistributionMockArtifact from '../artifacts/contracts/mock/DistributionMock.sol/DistributionMock.json';

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

function randInt(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function generateSigner(provider: Provider): Promise<Signer> {
    const signer = ethers.Wallet.createRandom(provider);
    await setBalance(signer.address, ethers.parseEther("100"));

    return signer;
}

describe('TacVesting', function () {
    let admin: HardhatEthersSigner;
    let testSdk: TacLocalTestSdk;

    let stakingProxy: StakingProxyTest;

    let stakingMock: StakingMock;
    let distributionMock: DistributionMock;

    // random number of users between 10 and 20
    const usersCount: number = Math.floor(Math.random() * 20 + 10);
    let tvmUsers: string[];

    const validatorAddress = "ValidatorAddress";

    let COMPLETION_TIMEOUT: bigint;

    // users withdraw/undelegation info
    let usersUndelegation: {
        [key: string]: bigint;
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
        await setBalance(crossChainLayerAddress, ethers.parseEther("100000000000000000"));

        COMPLETION_TIMEOUT = await stakingMock.COMPLETION_TIMEOUT();

        stakingProxy = await deployUpgradableLocal<StakingProxyTest>(
            admin as unknown as Signer,
            hre.artifacts.readArtifactSync("StakingProxyTest"),
            [
                crossChainLayerAddress, // cross chain layer address
                saFactoryAddress, // sa factory address
                await admin.getAddress(), // admin address
            ],
            {
                kind: "uups",
            },
            undefined,
            true
        );

        // generate users
        tvmUsers = [];
        for (let i = 0; i < usersCount; i++) {
            const user = `TVM-USER-${i}`;
            tvmUsers.push(user);
        }
    });

    async function sendMessage(tvmCaller: string, methodName: string, encodedArguments: string, amount: bigint): Promise<SendMessageOutput> {
        const shardsKey = BigInt(randInt(0, 10000));
        const operationId = ethers.encodeBytes32String(`operation-${shardsKey}`);
        const target = await stakingProxy.getAddress();

        return await testSdk.sendMessage(
            shardsKey,
            target,
            methodName,
            encodedArguments,
            tvmCaller,
            [],
            [],
            amount,
            "0x",
            operationId
        );
    }

    it ('Should delegate tokens to the staking precompile', async function () {

        for (let i = 0; i < tvmUsers.length; i++) {
            const user = tvmUsers[i];
            const amount = ethers.parseEther((randInt(1, 1000) / 100).toString());

            // encode delegate message
            const encoded = abiCoder.encode(
                ["tuple(string,uint256)"],
                [[validatorAddress, amount]]
            );

            await sendMessage(user, "delegate(bytes,bytes)", encoded, amount);
        }
    });

});
