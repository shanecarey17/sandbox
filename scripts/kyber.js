const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const tokens = require('./tokens.js');
const wallet = require('./wallet.js');
const constants = require('./constants.js');

const KYBER_PRECISION = 18;

function KyberSwap(contract) {
    this.contract = contract;
}

KyberSwap.prototype.onSwap = function(callback) {
    this.contract.on('ExecuteTrade', async (sender, src, dst, usrSrcDelta, usrDstDelta) => {
        src = await tokens.TokenFactory.getTokenByAddress(src);
        dst = await tokens.TokenFactory.getTokenByAddress(dst);

        let exchRate;

        if (dst.decimals.gte(src.decimals)) {
            exchRate = usrDstDelta.mul(constants.TEN.pow(KYBER_PRECISION)).div(usrSrcDelta).div(constants.TEN.pow(dst.decimals - src.decimals));
        } else {
            exchRate = usrDstDelta.mul((constants.TEN.pow(src.decimals - dst.decimals + KYBER_PRECISION))).div(usrSrcDelta);
        }

        callback(this, src, dst, exchRate);
    });
}

KyberSwap.prototype.getExchangeRate = async function(src, dst, srcAmount) {
    assert(srcAmount != 0);

    let result = await this.contract.getExpectedRate(src.contract.address, dst.contract.address, srcAmount);

    return result.expectedRate;
}

module.exports = {
    create: async function(address) {
        var contract = await ethers.getContractAt('IKyberNetworkProxy', address, wallet);

        return new KyberSwap(contract);
    }
}