usePlugin('@nomiclabs/buidler-ganache');
usePlugin("@nomiclabs/buidler-waffle");
usePlugin("buidler-deploy");

const fs = require('fs');
const assert = require('assert');

const INFURA_URL = process.env.INFURA_URL;
assert(INFURA_URL != null);

//const INFURA_URL = 'https://mainnet.infura.io/v3/e4aa52bf76a948ea92ae7772d299aef0'; // Chris
//const INFURA_URL = 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d'; // Shane

const MAINNET_KEY = process.env.PRIVATE_KEY; // fs.readFileSync('.mainnet.key').toString().trim();
assert(MAINNET_KEY != null);

const log4js = require('log4js');

log4js.configure({
  appenders: {
      ganache: {
          type: 'file',
          filename: 'var/ganache.log',
      }
  },
  categories: {
      default: {
          appenders: ['ganache'],
          level: 'info',
      }
  }
});

function GanacheLogger(logger) {
    this.logger = logger

    this.log = function() {
        this.logger.info(...arguments);
    }
}

task('compoundCheckAccount', "Fetch account info for compound account")
    .addParam('account', 'account address')
    .setAction(async (args) => {
        const checkAccount = require('./scripts/compound/check_account.js');

	await checkAccount(args.account);
    });

task('createWallet', "Create a wallet and output private key")
    .addParam('keyfile', 'file to save the private key of the created wallet')
    .setAction(async (args) => {
        const createWallet = require('./scripts/create_wallet.js');

        await createWallet(args.keyfile);
    });

task('runLiquidator', "run the liquidator application")
    .addParam('live', 'set to "true" for live liquidation')
    .setAction(async (args) => {
        const liquidator = require('./scripts/compound/liquidation.js');

        const isLive = args.live in ['t', 'true'];

        await liquidator(isLive);
    });

module.exports = {
    verbose: true,
    defaultNetwork: 'ganache',
    networks: {
        ganache: {
            // Ganache options
            fork: INFURA_URL,
            network_id: 5777,
            port: 8545,
            logger: new GanacheLogger(log4js.getLogger('ganache')),
            keepAliveTimeout: 600 * 1000, // ms
            ws: false,
            verbose: false, // prints requests/responses
            debug: false, // prints opcodes exec'd
            unlocked_accounts: [
                "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C", // https://etherscan.io/address/0x9eb7f2591ed42dee9315b6e2aaf21ba85ea69f8c
                "0x6dcb8492b5de636fd9e0a32413514647d00ef8d0", // second dai whale
                "0x18c8f1222083997405f2e482338a4650ac02e1d6", // compound admin https://etherscan.io/address/0xaf601cbff871d0be62d18f79c31e387c76fa0374#readContract
                "0x6d903f6003cca6255D85CcA4D3B5E5146dC33925", // timelock compound
                "0x8cee3eeab46774c1cde4f6368e3ae68bccd760bf", // usdc whale https://etherscan.io/token/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48?a=0x8cee3eeab46774c1cde4f6368e3ae68bccd760bf
                "0x742d35cc6634c0532925a3b844bc454e4438f44e", // ETH whale https://etherscan.io/address/0x742d35cc6634c0532925a3b844bc454e4438f44e
                "0xf38da89048346b33527617dc1deb592921bb6c83", // ZRX whale 
            ],

            // Buidler options
            url: 'http://localhost:8545',
            timeout: 600 * 1000,
        },
        mainnet: {
            url: INFURA_URL,
            accounts: [
                MAINNET_KEY,
            ],
            timeout: 30 * 1000, // infura is slow sometimes...
        },
        rinkeby: {
            url: INFURA_URL.replace('mainnet', 'rinkeby'),
            accounts: [
                MAINNET_KEY,
            ]
        },
        kovan: {
            url: INFURA_URL.replace('mainnet', 'kovan'),
            accounts: [
                MAINNET_KEY,
            ]
        }
    },
    solc: {
        version: "0.6.0",
        optimizer: {
            enabled: true,
            runs: 200
        }
    },
    paths: {
        sources: "./contracts",
        tests: "./test",
        cache: "./cache",
        artifacts: "./artifacts",

        // buidler-deploy
        deploy: './deploy',
        deployments: './deployments',
    },
    mocha: {
        timeout: 3600 * 1000 // ms, tests are long running
    },
    namedAccounts: {
        // Public keys here
        deployer: {
            default: 0, // Index of first account
        }
    }
};
