usePlugin('@nomiclabs/buidler-ganache');
usePlugin("@nomiclabs/buidler-waffle");
usePlugin('buidler-ethers-v5');

const legos = require('@studydefi/money-legos').legos;

const fs = require('fs');
const mnemonic = fs.readFileSync('.secret').toString().trim();

/*
 * Ganache logging
 */

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

/*
 * Tasks
 */



/*
 * Exports
 */

module.exports = {
    verbose: true,
    defaultNetwork: 'ganache',
    networks: {
        ganache: {
            // Ganache options
            fork: 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d',
            mnemonic: mnemonic,
            network_id: 5777,
            port: 8545,
            logger: new GanacheLogger(log4js.getLogger('ganache')),
            keepAliveTimeout: 300 * 1000, // ms
            ws: false,
            //db: './db/',
            verbose: true,
            debug:false,
            unlocked_accounts: [
                "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C", // DAI holder
            ],

            // Buidler options
            url: 'http://localhost:8545',
            timeout: 300 * 1000,
        }
        // development: {
        //     url: 'http://localhost:8545'
        // },
        // mainnet: {
        //     url: 'https://mainnet.infura.io/v3/e4aa52bf76a948ea92ae7772d299aef0', // Chris
        //     //url: 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d', // Shane
        // }
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
        artifacts: "./artifacts"
    },
    mocha: {
        timeout: 3600 * 1000 // ms, tests are long running
    }
};
