export type DeployConfig = {
    stackingContractAddress: string;
    distributionContractAddress: string;
    stepDuration: bigint;
}

export const mainnetConfig: DeployConfig = {
    stackingContractAddress: '0x0000000000000000000000000000000000000800',
    distributionContractAddress: '0x0000000000000000000000000000000000000801',
    stepDuration: 3600n * 24n * 30n, // 30 days in seconds
};