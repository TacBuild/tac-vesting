import * as dotenv from "dotenv";

import "@nomicfoundation/hardhat-chai-matchers";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
// import "hardhat-storage-layout";
import "hardhat-contract-sizer";
import 'solidity-coverage';
import { HardhatUserConfig } from "hardhat/config";
dotenv.config();

const TAC_MAINNET_URL = process.env.TAC_MAINNET_URL || "http://127.0.0.1:8545";
const TAC_STAKING_TEST_URL = process.env.TAC_STAKING_TEST_URL || "http://127.0.0.1:8545";
const TAC_TESTNET_SPB_URL = process.env.TAC_TESTNET_SPB_URL || "http://127.0.0.1:8545";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ],
  },
  networks: {
    hardhat: {
      chainId: 1337,
      accounts: {
        count: 50
      }
    },
    localhost: {
	    url:  "http://127.0.0.1:8545",
      timeout: 360000
    },
    tac_mainnet: {
      chainId: 239,
      url: TAC_MAINNET_URL,
      timeout: 360000
    },
    tac_staking_test: {
      chainId: 2391337,
      url: TAC_STAKING_TEST_URL
    },
    tac_testnet_spb: {
      chainId: 2391,
      url: TAC_TESTNET_SPB_URL,
      timeout: 360000
    }
  },
  gasReporter: {
    enabled: false,
    currency: 'ETH',
    gasPrice: 1
  },
  contractSizer: {
    alphaSort: false,
    runOnCompile: false,
    disambiguatePaths: false,
  },
  etherscan: {
    apiKey: {
      tac_mainnet: 'empty',
      tac_testnet: 'empty',
      tac_testnet_spb: 'empty'
    },
    customChains: [
      {
        network: "tac_mainnet",
        chainId: 239,
        urls: {
          apiURL: "https://explorer.tac.build/api",
          browserURL: "https://explorer.tac.build"
        }
      },
      {
        network: "tac_testnet",
        chainId: 2390,
        urls: {
          apiURL: "https://turin.explorer.tac.build/api",
          browserURL: "https://turin.explorer.tac.build"
        }
      },
      {
        network: "tac_testnet_spb",
        chainId: 2391,
        urls: {
          apiURL: "https://spb.explorer.tac.build/api",
          browserURL: "https://spb.explorer.tac.build"
        }
      }
    ]
  }
};

export default config;

