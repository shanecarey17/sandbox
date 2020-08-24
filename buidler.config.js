usePlugin('@nomiclabs/buidler-ganache');
usePlugin("@nomiclabs/buidler-waffle");
usePlugin("buidler-deploy");

const fs = require('fs');

const MNEMONIC = fs.readFileSync('.secret').toString().trim();

//const INFURA_URL = 'https://mainnet.infura.io/v3/e4aa52bf76a948ea92ae7772d299aef0'; // Chris
const INFURA_URL = 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d'; // Shane

const MAINNET_KEY = fs.readFileSync('.mainnet.key').toString().trim();

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

module.exports = {
    verbose: true,
    defaultNetwork: 'ganache',
    networks: {
        ganache: {
            // Ganache options
            fork: INFURA_URL,
            mnemonic: MNEMONIC,
            network_id: 5777,
            port: 8545,
            logger: new GanacheLogger(log4js.getLogger('ganache')),
            keepAliveTimeout: 600 * 1000, // ms
            ws: false,
            verbose: false, // prints requests/responses
            debug: false, // prints opcodes exec'd
            unlocked_accounts: [
                "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C", // https://etherscan.io/address/0x9eb7f2591ed42dee9315b6e2aaf21ba85ea69f8c
            ],

            // Buidler options
            url: 'http://localhost:8545',
            timeout: 600 * 1000,
        },
        mainnet: {
            url: INFURA_URL,
            accounts: [
                MAINNET_KEY
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
