import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { TacVesting, StakingProxy } from "../../typechain-types";
import { DeployConfig } from "../config/config";
import { Signer } from "ethers";

export async function deployTacVesting(deployer: Signer, config: DeployConfig ): Promise<TacVesting> {
    const TacVesting = await ethers.getContractFactory("TacVesting", deployer);
    const tacVesting = await upgrades.deployProxy(
        TacVesting,
        [
            config.crossChainLayerAddress, // cross chain layer address
            config.saFactoryAddress, // sa factory address
            await deployer.getAddress(), // admin address
            config.stepDuration // step duration in seconds
        ],
        {
            kind: "uups",
        }
    );

    await tacVesting.waitForDeployment();

    return tacVesting;
}

export async function deployStakingProxy(deployer: Signer, config: DeployConfig): Promise<StakingProxy> {
    const StakingProxy = await ethers.getContractFactory("StakingProxy", deployer);
    const stakingProxy = await upgrades.deployProxy(
        StakingProxy,
        [
            config.crossChainLayerAddress, // cross chain layer address
            config.saFactoryAddress, // sa factory address
            await deployer.getAddress(), // admin address
        ],
        {
            kind: "uups",
        }
    );

    await stakingProxy.waitForDeployment();

    return stakingProxy;
}
