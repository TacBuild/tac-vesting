import hre, { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { TacVesting, StakingProxy } from "../../typechain-types";
import { DeployConfig } from "../config/config";
import { Signer } from "ethers";
import { deployUpgradable } from "@tonappchain/evm-ccl";

export async function deployTacVesting(deployer: Signer, config: DeployConfig ): Promise<TacVesting> {
    return await deployUpgradable<TacVesting>(
        deployer,
        hre.artifacts.readArtifactSync("TacVesting"),
        [
            config.crossChainLayerAddress, // cross chain layer address
            config.saFactoryAddress, // sa factory address
            await deployer.getAddress(), // admin address
            config.stepDuration, // step duration
        ],
        {
            kind: "uups",
        },
        undefined,
        true
    );
}

export async function deployStakingProxy(deployer: Signer, config: DeployConfig): Promise<StakingProxy> {
    return await deployUpgradable<StakingProxy>(
        deployer,
        hre.artifacts.readArtifactSync("StakingProxy"),
        [
            config.crossChainLayerAddress, // cross chain layer address
            config.saFactoryAddress, // sa factory address
            await deployer.getAddress(), // admin address
        ],
        {
            kind: "uups",
        },
        undefined,
        true
    );
}
