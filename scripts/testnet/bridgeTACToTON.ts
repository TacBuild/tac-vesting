import { ethers } from "hardhat";
import { Network, TacSdk } from "@tonappchain/sdk";
import { TonClient } from "@ton/ton";

async function main() {

    const bridgeAmount = ethers.parseEther("100000");
    const tonWallet = "0QDNNBEAsX5vjftxckJuEVP8rPrN5NwTAxWibf9kvFk6DVc2";

     // validator
    const validatorPrivateKey = process.env.VALIDATOR_PRIVATE_KEY!;
    const validator = new ethers.Wallet(validatorPrivateKey, ethers.provider);

    const tonClientEndpoint = process.env.TON_CLIENT_ENDPOINT;
    const tonClientApiKey = process.env.TON_CLIENT_API_KEY;

    let tonClient: TonClient | undefined;
    if (tonClientEndpoint && tonClientApiKey) {
        tonClient = new TonClient({
            endpoint: tonClientEndpoint,
            apiKey: tonClientApiKey,
        });
    }

    const sdkParams = {
        network: Network.TESTNET,
        customLiteSequencerEndpoints: ["http://34.203.126.155:8081"],
        TACParams: {
            provider: new ethers.JsonRpcProvider("http://34.203.126.155:8545"),
            settingsAddress: "0x9c57864c160DDaEecff1bB9f4ab86a431D9588c8",
        },
        TONParams: {
            settingsAddress: "EQBoFw42dxrFcBH4Wqdm7NNKxIwj6fMnl-2zIPs02Xrf_HPG",
        },
    }

    const tacSdk = await TacSdk.create(sdkParams);

    const txHash = await tacSdk.bridgeTokensToTON(validator, bridgeAmount, tonWallet);

    console.log(`Bridged ${ethers.formatEther(bridgeAmount)} TAC to TON wallet ${tonWallet} with transaction hash: ${txHash}`);
}

main();