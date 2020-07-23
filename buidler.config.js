usePlugin('@nomiclabs/buidler-ethers');

module.exports = {
    defaultNetwork: 'mainnet',
    networks: {
        development: {
            url: 'http://localhost:8545'
        },
        mainnet: {
            url: 'https://mainnet.infura.io/v3/e4aa52bf76a948ea92ae7772d299aef0', // Chris
            //url: 'https://mainnet.infura.io/v3/b6b445ca6dbc424f9a9309cb14ddae5d', // Shane
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
        artifacts: "./artifacts"
    }
};
