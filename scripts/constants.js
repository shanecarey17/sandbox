const ethers = require("@nomiclabs/buidler").ethers;

module.exports = {
    TEN: ethers.BigNumber.from(10),
    ZERO: ethers.BigNumber.from(0),

    DISPLAY_DECIMALS: 7,
    DISPLAY_PADDING: 14,

    // https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
    CONSOLE_RED: '\x1b[31m%s\x1b[0m',
    CONSOLE_GREEN: '\x1b[32m%s\x1b[0m',
}