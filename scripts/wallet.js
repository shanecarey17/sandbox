const ethers = require("@nomiclabs/buidler").ethers;
const fs = require('fs');

const mnemonic = fs.readFileSync('.secret', 'utf8').toString().trim();

module.exports = ethers.Wallet.fromMnemonic(mnemonic).connect(ethers.provider);