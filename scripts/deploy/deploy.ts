import { ethers } from "hardhat";
import { upgrades } from "hardhat";
import { TacVesting } from "../../typechain-types";
import { DeployConfig } from "../config/config";
import { Signer } from "ethers";

export async function deployTacVesting(deployer: Signer, config: DeployConfig ): Promise<TacVesting> {
    const TacVesting = await ethers.getContractFactory("TacVesting", deployer);
    const tacVesting = await upgrades.deployProxy(
        TacVesting,
        [
            deployer.getAddress(), // admin address
            config.stackingContractAddress, // stacking contract address
            config.distributionContractAddress, // distribution contract address
            config.stepDuration // step duration in seconds
        ],
        {
            kind: "uups",
        }
    );

    await tacVesting.waitForDeployment();

    return tacVesting;
}
