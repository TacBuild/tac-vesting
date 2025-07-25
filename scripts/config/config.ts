import { ethers } from "hardhat";
import { RewardsConfig } from "../utils/rewards";

export type DeployConfig = {
    crossChainLayerAddress: string;
    saFactoryAddress: string;
    stepDuration: bigint;
}

export const mainnetConfig: DeployConfig = {
    crossChainLayerAddress: "0x9fee01e948353E0897968A3ea955815aaA49f58d",
    saFactoryAddress: "0x070820Ed658860f77138d71f74EfbE173775895b",
    stepDuration: 3600n * 24n * 30n, // 30 days in seconds
};

export const testnetConfig: DeployConfig = {
    crossChainLayerAddress: "0x4f3b05a601B7103CF8Fc0aBB56d042e04f222ceE",
    saFactoryAddress: "0x5919D1D0D1b36F08018d7C9650BF914AEbC6BAd6",
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