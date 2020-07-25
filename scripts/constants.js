const ethers = require("@nomiclabs/buidler").ethers;

const ZERO = ethers.BigNumber.from(0);
const TEN = ethers.BigNumber.from(10);

const DISPLAY_DECIMALS = 7;

module.exports = {
    TEN: TEN,
    ZERO: ZERO,
    DISPLAY_DECIMALS: DISPLAY_DECIMALS
}