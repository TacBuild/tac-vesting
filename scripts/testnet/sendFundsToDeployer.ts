import { ethers } from "hardhat";

async function main() {
    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);

    const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY!;
    const deployer = new ethers.Wallet(deployerPrivateKey, ethers.provider);

    const deployerBalance = await deployer.provider!.getBalance(await deployer.getAddress());
    const validatorBalance = await validator.provider!.getBalance(await validator.getAddress());

    console.log(`Deployer balance: ${ethers.formatEther(deployerBalance)} TAC`);
    console.log(`Validator balance: ${ethers.formatEther(validatorBalance)} TAC`);

    // Send funds from validator to deployer
    const amountToSend = ethers.parseEther("100000"); // Adjust the amount as needed

    if (deployerBalance >= ethers.parseEther("10000")) {
        console.error("Deployer have enough funds");
        return;
    }

    const tx = await validator.sendTransaction({
        to: await deployer.getAddress(),
        value: amountToSend
    });
    await tx.wait();

    console.log(`Sent ${ethers.formatEther(amountToSend)} TAC from validator to deployer`);
    const newDeployerBalance = await deployer.provider!.getBalance(await deployer.getAddress());
    console.log(`New deployer balance: ${ethers.formatEther(newDeployerBalance)} TAC`);
}

main()