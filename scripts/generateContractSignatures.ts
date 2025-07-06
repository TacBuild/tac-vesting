import hre from "hardhat";
import path from "path";
import * as fs from "fs";
import { getContractSignatures } from "@tonappchain/evm-ccl";
import { Artifacts } from "hardhat/internal/artifacts";

async function main() {
    let addressFilePath = path.resolve(__dirname, `../../signatures.json`);

    const artifacts = new Artifacts(path.resolve(__dirname, `../../artifacts`));
    const signatires = await getContractSignatures(artifacts);

    fs.writeFileSync(addressFilePath, JSON.stringify(signatires, null, 2));
}

main();