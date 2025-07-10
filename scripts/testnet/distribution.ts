import { ethers } from "hardhat";
import { StakingI, DistributionI, TacVesting } from "../../typechain-types/";
import { DistributionPrecompileAddress, StakingPrecompileAddress } from "../config/config";

async function main() {

    const validatorAddress = "tacvaloper15lvhklny0khnwy7hgrxsxut6t6ku2cgkwu9tyt";
    const userAddress = "EQCX-DCrFGRcgEP9253glFXbgbS0LfzgQsQ18PucL-udvhFd"

    const tacVestingAddress = "0x76568eDcEdc96B928CF2309E4D327168b38d25CD";

    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);

    const staking = await ethers.getContractAt("StakingI", StakingPrecompileAddress, validator);
    const distribution = await ethers.getContractAt("DistributionI", DistributionPrecompileAddress, validator);
    const tacVesting = await ethers.getContractAt("TacVesting", tacVestingAddress, validator);

    const userInfo = await tacVesting.info(userAddress);

    console.log(`User smart account: ${userInfo.smartAccount}`);

    // get user's staking info
    const userStakingInfo = await staking.delegation(userInfo.smartAccount, validatorAddress);

    console.log(`User delegation: ${userStakingInfo}`);

    const userRewards = await distribution.delegationRewards(userInfo.smartAccount, validatorAddress);

    console.log(`User rewards: ${userRewards}`);
}

main();
