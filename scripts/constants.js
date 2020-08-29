const ethers = require("@nomiclabs/buidler").ethers;

module.exports = {
    TEN: ethers.BigNumber.from(10),
    ZERO: ethers.BigNumber.from(0),

    DISPLAY_DECIMALS: 7,
    DISPLAY_PADDING: 14,

    // https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
    CONSOLE_RED: '\x1b[31m%s\x1b[0m',
    CONSOLE_GREEN: '\x1b[32m%s\x1b[0m',

    PATH_LENGTH: 2,

    START_VALUE_ETH: ethers.utils.parseEther('1.5'),

    KYBER_PRECISION: 18,

    ETH_ADDRESS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',

    STRATEGY_NAME: 'StrategyV1',
    ADDRESS_FILE_NAME: 'contracts.json',

    GAS_PRICE: ethers.utils.parseUnits('58', 'gwei'),
    GAS_ESTIMATE: 1387218,

    TOKENS_FILENAME: './tokens_min.txt',

    EXECUTE_INTERVAL: 5000, // ms

    KYBER_NETWORK_ADDRESS: '0x7C66550C9c730B6fdd4C03bc2e73c5462c5F7ACC',
    KYBER_PROXY_ADDRESS: '0x818E6FECD516Ecc3849DAf6845e3EC868087B755',

    SERVER_PORT: 8080,

    LIQUIDATION_GAS_PRICE: '100', // in gwei

    LIQUIDATION_GAS_LIMIT: ethers.BigNumber.from(10**6),
}