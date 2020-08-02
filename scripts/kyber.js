const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const tokens = require('./tokens.js');
const wallet = require('./wallet.js');
const constants = require('./constants.js');

function KyberSwap(proxyContract, networkContract) {
    this.name = "KyberSwap";

    this.proxyContract = proxyContract;
    this.networkContract = networkContract;

    this.getExchangeRate = async (src, dst, srcAmount) => {
        assert(src != dst);

        if (srcAmount.eq(0)) {
            return constants.ZERO;
        }

        try {
            let result = await this.proxyContract.getExpectedRate(src.contract.address, dst.contract.address, srcAmount);

            return result.expectedRate;
        } catch (err) {
            console.log(err);
        }
    }

    this.listen = (callback) => {
        this.networkContract.on('KyberTrade', callback);
    }
}

module.exports = {
    load: async function(callback) {
        var proxyContract = await ethers.getContractAt('IKyberNetworkProxy', constants.KYBER_PROXY_ADDRESS, wallet); 
        var networkContract = await ethers.getContractAt('IKyberNetwork', constants.KYBER_NETWORK_ADDRESS, wallet);

        return new KyberSwap(proxyContract, networkContract);
    }
}