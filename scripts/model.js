const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');
const debug = require('debug')('model');

const constants = require('./constants');
const tokens = require('./tokens.js');

function Model() {
    this.graph = new Map();

    this.updateRate = (src, dst, exchange) => {
        if (!this.graph.has(src)) {
            this.graph.set(src, new Map());
        }

        this.graph.get(src).set(dst, exchange);
    };

    this.calcExchangeRate = (src, dst, srcAmount, dstAmount) => {
        if (srcAmount == 0) {
            return constants.ZERO;
        }

        if (dst.decimals.gte(src.decimals)) {
            return dstAmount.mul(constants.TEN.pow(constants.KYBER_PRECISION)).div(srcAmount).div(constants.TEN.pow(dst.decimals - src.decimals));
        } else {
            return dstAmount.mul((constants.TEN.pow(src.decimals - dst.decimals + constants.KYBER_PRECISION))).div(srcAmount);
        }
    }

    // this.calcDstAmount = (src, dst, exchRate, srcAmount) => {
    //     // https://github.com/KyberNetwork/smart-contracts/blob/master/contracts/Utils.sol
    //     // Returns dst amount
    //     if (dst.decimals.gte(src.decimals)) {
    //         return srcAmount.mul(exchRate).mul(constants.TEN.pow(dst.decimals - src.decimals)).div(constants.TEN.pow(constants.KYBER_PRECISION));
    //     } else {
    //         return srcAmount.mul(exchRate).div(constants.TEN.pow(src.decimals - dst.decimals + constants.KYBER_PRECISION));
    //     }
    // }

    let calcReferencePx = (src, srcAmount) => {
        if (constants.USE_USD_REFERENCE_PX) {
            // Use a 2 decimal fake ref px for usd
            // important to return BigNumber here
            return ethers.BigNumber.from(String(BigInt(Math.ceil(Number(src.formatAmount(srcAmount)) * src.price * 10**2))));
        }

        // let eth = tokens.TokenFactory.getEthToken();

        // if (src === eth) {
        //     return srcAmount;
        // }

        // return this.calcDstAmount(src, eth, src0.ethRate, srcAmount); // TODO FIX after exchange
    }

    let getBestRouteInternal = (src0, src, srcAmount, n, route) => {
        if (!this.graph.has(src)) {
            return [];
        }

        var bestRoute = [];
        var bestReturn = constants.ZERO;

        for (const [dst, exchange] of this.graph.get(src)) {
            if (dst === src) {
                continue;
            }

            var dstAmount = exchange.calcDstAmount(src, dst, srcAmount);

            if (dstAmount == 0) {
                // debug(`No trade from ${src.symbol} ${dst.symbol}`);

                continue;
            }

            debug(`Model trade ${src.formatAmount(srcAmount)} ${src.symbol} => ${dst.formatAmount(dstAmount)} ${dst.symbol}`);

            // Handle base case, back to src0
            if (n == 0) {
                if (dst !== src0) {
                    continue;
                }

                return [...route, {
                    src: src,
                    srcAmount: srcAmount,
                    dst: dst,
                    dstAmount: dstAmount,
                    exchRate: this.calcExchangeRate(src, dst, srcAmount, dstAmount),
                }];
            }

            // Otherwise recurse
            var dstRoute = getBestRouteInternal(src0, dst, dstAmount, n - 1, [...route, {
                src: src,
                srcAmount: srcAmount,
                dst: dst,
                dstAmount: dstAmount,
                exchRate: this.calcExchangeRate(src, dst, srcAmount, dstAmount),
            }]);

            if (dstRoute.length == 0) {
                continue;
            }

            assert(dstRoute[dstRoute.length -1].dst == src0);

            var routeReturn = calcReferencePx(src0, dstRoute[dstRoute.length - 1].dstAmount);

            if (routeReturn.gte(bestReturn)) {
                debug(`Model updated best return ${src0.symbol} ${src0.formatAmount(routeReturn)}`);

                bestRoute = dstRoute; 
                bestReturn = routeReturn;
            }
        }

        return bestRoute;
    };

    this.getBestRoute = (src, srcAmount) => {
        var bestRoute = getBestRouteInternal(src, src, srcAmount, constants.PATH_LENGTH - 1, []);

        if (bestRoute.length > 0) {
            assert(bestRoute[0].src == bestRoute[bestRoute.length - 1].dst);
        }

        return bestRoute;
    }

    this.getBestRate = (src, dst, srcAmount) => {
        if (!this.graph.has(src)) {
            return constants.ZERO;
        }

        let srcNode = this.graph.get(src);

        if (!srcNode.has(dst)) {
            return constants.ZERO;
        }

        return srcNode.get(dst);
    }

    this.serialize = () => {
        let data = {};

        for (const [src, exchRates] of this.graph) {
            for (const [dst, exchRate] of exchRates) {
                if (!(src.symbol in data)) {
                    data[src.symbol] = {};
                }

                data[src.symbol][dst.symbol] = (exchRate / (10**18)).toFixed(constants.DISPLAY_DECIMALS);
            }
        }

        return data;
    }
    
    // TODO add method to get direct rate
}

module.exports = {
    Model: Model
}