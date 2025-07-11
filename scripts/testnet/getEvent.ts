import { ethers } from "hardhat";


async function main() {

    const stakingProxyAddress = "0x4f3b05a601B7103CF8Fc0aBB56d042e04f222ceE";
    const stakingProxy = await ethers.getContractAt("StakingProxy", stakingProxyAddress);

    const eventFilter = stakingProxy.filters.Delegated();

    const events = [];
    let fromBlock = 0;
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
        console.log(`Delegated, txHash: ${event.transactionHash}, args: ${event.args?.tvmCaller} delegated ${event.args?.validatorAddress} TAC to ${ethers.formatEther(event.args?.amount)}`);
    }
}

main()