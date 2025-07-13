import { ethers } from "hardhat";


async function main() {

    const stakingProxyAddress = "0x65950Fd666C26fd0ffCF1D1B1543b8089eEbf7eB";
    const stakingProxy = await ethers.getContractAt("StakingProxy", stakingProxyAddress);

    const eventFilter = stakingProxy.filters.Delegated();

    const events = [];
    let fromBlock = 2890553;
    let toBlock = 0;
    const latestBlock = await ethers.provider.getBlockNumber();

    while (fromBlock <= latestBlock) {
        toBlock = fromBlock + 10000; // Fetch events in chunks of 10000 blocks
        if (toBlock > latestBlock) {
            toBlock = latestBlock;
        }
        const fetchedEvents = await stakingProxy.queryFilter(eventFilter, fromBlock, toBlock);
        events.push(...fetchedEvents);
        fromBlock = toBlock + 1; // Move to the next chunk
    }

    for (const event of events) {
        console.log(`Delegated, txHash: ${event.transactionHash}, args: wallet ${event.args?.tvmCaller} validator ${event.args?.validatorAddress} amount ${ethers.formatEther(event.args?.amount)} TAC`);
    }
}

main()