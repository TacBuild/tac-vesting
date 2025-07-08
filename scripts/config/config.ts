import { ethers } from "hardhat";
import { RewardsConfig } from "../utils/rewards";

export type DeployConfig = {
    crossChainLayerAddress: string;
    saFactoryAddress: string;
    stepDuration: bigint;
}

export const mainnetConfig: DeployConfig = {
    crossChainLayerAddress: "",
    saFactoryAddress: "",
    stepDuration: 3600n * 24n * 30n, // 30 days in seconds
};

export const testnetConfig: DeployConfig = {
    crossChainLayerAddress: "0x4f3b05a601B7103CF8Fc0aBB56d042e04f222ceE",
    saFactoryAddress: "",
    stepDuration: 60n * 6n, // 6 mins
};

export const locatTestnetConfig: DeployConfig = {
    crossChainLayerAddress: "0xE65C5D7A6cb6BDF92c4B07965bCB05eB7bcC352d",
    saFactoryAddress: "0x4eAF5Dab49a7F0E0CA5A9ff61fC1A00b727D46a3",
    stepDuration: 60n * 6n, // 6 mins
};

export const localConfig: DeployConfig = {
    crossChainLayerAddress: "0xE65C5D7A6cb6BDF92c4B07965bCB05eB7bcC352d",
    saFactoryAddress: "0x4eAF5Dab49a7F0E0CA5A9ff61fC1A00b727D46a3",
    stepDuration: 60n * 6n, // 5 mins
};

export const StakingPrecompileAddress = "0x0000000000000000000000000000000000000800";
export const DistributionPrecompileAddress = "0x0000000000000000000000000000000000000801";