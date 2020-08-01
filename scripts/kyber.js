const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const tokens = require('./tokens.js');
const wallet = require('./wallet.js');
const constants = require('./constants.js');

function KyberSwap(contract) {
    this.name = "KyberSwap";

    this.contract = contract;

    this.getExchangeRate = async (src, dst, srcAmount) => {
        assert(src != dst);

        if (srcAmount.eq(0)) {
            return constants.ZERO;
        }

        try {
            let result = await this.contract.getExpectedRate(src.contract.address, dst.contract.address, srcAmount);

            return result.expectedRate;
        } catch (err) {
            console.log(err);
        }
    }

    this.listen = (callback) => {
        this.contract.on('ExecuteTrade', callback);
        // this.contract.on('ExecuteTrade', async (sender, src, dst, usrSrcDelta, usrDstDelta) => {
        //     let srcToken = tokens.TokenFactory.getTokenByAddress(src);
        //     let dstToken = tokens.TokenFactory.getTokenByAddress(dst);

        //     if ((srcToken === undefined) || (dstToken === undefined)) {
        //         return;
        //     }

        //     let exchRate;

        //     if (dstToken.decimals.gte(srcToken.decimals)) {
        //         exchRate = usrDstDelta.mul(constants.TEN.pow(constants.KYBER_PRECISION)).div(usrSrcDelta).div(constants.TEN.pow(dstToken.decimals - srcToken.decimals));
        //     } else {
        //         exchRate = usrDstDelta.mul((constants.TEN.pow(srcToken.decimals - dstToken.decimals + constants.KYBER_PRECISION))).div(usrSrcDelta);
        //     }

        //     callback(this, srcToken, dstToken, exchRate);
        // });
    }
}

module.exports = {
    load: async function(address, callback) {
        var contract = await ethers.getContractAt('IKyberNetworkProxy', address, wallet);

        return new KyberSwap(contract, callback);
    }
}