export type DeployConfig = {
    crossChainLayerAddress: string;
    stepDuration: bigint;
}

export const mainnetConfig: DeployConfig = {
    crossChainLayerAddress: "",
    stepDuration: 3600n * 24n * 30n, // 30 days in seconds
};

export const testnetConfig: DeployConfig = {
    crossChainLayerAddress: "0x",
    stepDuration: 60n * 1n, // 1 mins
};

export const localConfig: DeployConfig = {
    crossChainLayerAddress: "0xE69c2c0394325667E980f8699977d887DE4e3398",
    stepDuration: 60n * 7n, // 7 mins
};

export const StakingPrecompileAddress = "0x0000000000000000000000000000000000000800";
export const DistributionPrecompileAddress = "0x0000000000000000000000000000000000000801";