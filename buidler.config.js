usePlugin('@nomiclabs/buidler-ethers');
usePlugin('@nomiclabs/buidler-ganache');

const fs = require('fs');
const mnemonic = fs.readFileSync('.secret').toString().trim();

const log4js = require('log4js');
log4js.configure({
  appenders: [
    { type: 'console' },
    { type: 'file', filename: 'var/ganache.log', category: 'ganache' }
  ]
});

module.exports = {
    defaultNetwork: 'ganache',
    networks: {
        ganache: {
            fork: 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d',
            mnemonic: mnemonic,
            network_id: 5777,
            port: 8545,
            url: 'http://localhost:8545',
            logger: log4js.getLogger('ganache'),
            //unlocked_accounts: []
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
    }
};
