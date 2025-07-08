import { ethers } from "hardhat";

async function main() {

    const addressTo = "0xe9324478BF002a53a5dCE31d5cA7Dad336A7ed58";

    const amountToSend = ethers.parseEther("10000");

    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);

    let tx = await validator.sendTransaction({
        to: addressTo,
        value: amountToSend
    });
    await tx.wait();

    console.log(`Sent ${ethers.formatEther(amountToSend)} TAC to ${addressTo}`);
    const addressBalance = await validator.provider!.getBalance(addressTo);
    console.log(`New balance of ${addressTo}: ${ethers.formatEther(addressBalance)} TAC`);

}

main();