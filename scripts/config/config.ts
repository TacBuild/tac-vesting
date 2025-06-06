export type DeployConfig = {
    stepDuration: bigint;
}

export const mainnetConfig: DeployConfig = {
    stepDuration: 3600n * 24n * 30n, // 30 days in seconds
};

export const testnetConfig: DeployConfig = {
    stepDuration: 60n * 5n, // 5 mins
};

export const StakingPrecompileAddress = "0x0000000000000000000000000000000000000800";
export const DistributionPrecompileAddress = "0x0000000000000000000000000000000000000801";