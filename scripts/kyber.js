const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const tokens = require('./tokens.js');
const wallet = require('./wallet.js');
const constants = require('./constants.js');

function KyberSwap(contract, callback) {
    this.name = "KyberSwap";

    this.contract = contract;
    this.callback = callback;

    let cb = async (sender, src, dst, usrSrcDelta, usrDstDelta) => {
        src = await tokens.TokenFactory.getTokenByAddress(src);
        dst = await tokens.TokenFactory.getTokenByAddress(dst);

        let exchRate;

        if (dst.decimals.gte(src.decimals)) {
            exchRate = usrDstDelta.mul(constants.TEN.pow(constants.KYBER_PRECISION)).div(usrSrcDelta).div(constants.TEN.pow(dst.decimals - src.decimals));
        } else {
            exchRate = usrDstDelta.mul((constants.TEN.pow(src.decimals - dst.decimals + constants.KYBER_PRECISION))).div(usrSrcDelta);
        }

        await this.callback(this, src, dst, exchRate);
    }

    this.contract.on('ExecuteTrade', cb);

    this.getExchangeRate = async (src, dst, srcAmount) => {
        assert(srcAmount != 0);
        assert(src != dst);

        let result = await this.contract.getExpectedRate(src.contract.address, dst.contract.address, srcAmount);

        await this.callback(this, src, dst, result.expectedRate);

        return result.expectedRate;
    }
}

module.exports = {
    load: async function(address, callback) {
        var contract = await ethers.getContractAt('IKyberNetworkProxy', address, wallet);

        return new KyberSwap(contract, callback);
    }
}