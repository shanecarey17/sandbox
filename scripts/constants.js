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

    START_VALUE_USD: ethers.BigNumber.from(100),

    KYBER_PRECISION: 18,

    ETH_ADDRESS: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',

    STRATEGY_NAME: 'StrategyV1',
    ADDRESS_FILE_NAME: 'contracts.json',

    GAS_PRICE: ethers.utils.parseUnits('58', 'gwei'),
    GAS_ESTIMATE: 30000,

    TOKENS_FILENAME: './tokens.txt',
}