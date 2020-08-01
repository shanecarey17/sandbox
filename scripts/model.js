const ethers = require("@nomiclabs/buidler").ethers;
const assert = require('assert');

const constants = require('./constants');

function Model() {
    this.exchanges = [];
    this.graph = new Map();

    this.addExchange = (exchange) => {
        if (this.exchanges.indexOf(exchange) >= 0) {
            return;
        }

        this.exchanges.push(exchange);
    }

    this.updateRate = (exchange, src, dst, exchRate) => {
        if (exchRate == 0) {
            return;
        }

        if (!this.graph.has(src)) {
            this.graph.set(src, new Map());
        }

        this.graph.get(src).set(dst, exchRate);

        this.addExchange(exchange); // TODO track with rate when multiple
    };

    let trade = (src, dst, exchRate, srcAmount) => {
        // https://github.com/KyberNetwork/smart-contracts/blob/master/contracts/Utils.sol
        // Returns dst amount
        if (dst.decimals.gte(src.decimals)) {
            return srcAmount.mul(exchRate).mul(constants.TEN.pow(dst.decimals - src.decimals)).div(constants.TEN.pow(constants.KYBER_PRECISION));
        } else {
            return srcAmount.mul(exchRate).div(constants.TEN.pow(src.decimals - dst.decimals + constants.KYBER_PRECISION));
        }
    }

    let loadRates = (src, srcAmount) => {
        let allTokens = [];
        for (const [tok, _] of this.graph) {
            allTokens.push(tok);
        }

        return Promise.all(allTokens.map( (dst) => {
            return Promise.all(this.exchanges.map( (exchange) => { 
                return exchange.getExchangeRate(src, dst, srcAmount).then( () => {} );
            }));
        }));
    }

    let getBestRouteInternal = (src0, src, srcAmount, n, route) => {
        if (!this.graph.has(src)) {
            loadRates(src, srcAmount).then(() => {});
            return [];
        }

        if (n <= 0) {
            if (!this.graph.get(src).has(src0)) {
                return [];
            }

            var exchRate = this.graph.get(src).get(src0);

            var src0Amount = trade(src, src0, exchRate, srcAmount);

            return [...route, {
                src: src,
                srcAmount: srcAmount,
                dst: src0,
                dstAmount: src0Amount,
                exchRate: exchRate,
            }];
        }

        var bestRoute = [];
        var bestReturn = src == src0 ? srcAmount : route[0].srcAmount; // Must exceed starting amount

        for (const [dst, exchRate] of this.graph.get(src)) {
            // if (route.findIndex(function(t) { return t.src == dst; }) != -1) {
            //     continue;
            // }

            if (dst == src) {
                continue;
            }

            var dstAmount = trade(src, dst, exchRate, srcAmount);

            var dstRoute = getBestRouteInternal(src0, dst, dstAmount, n - 1, [...route, {
                src: src,
                srcAmount: srcAmount,
                dst: dst,
                dstAmount: dstAmount,
                exchRate: exchRate,
            }]);

            if (dstRoute.length == 0) {
                continue;
            }

            assert(dstRoute[dstRoute.length -1].dst == src0);

            var src0Return = dstRoute[dstRoute.length - 1].dstAmount;

            if (src0Return.gte(bestReturn)) {
                bestRoute = dstRoute; 
                bestReturn = src0Return;  
            }
        }

        return bestRoute;
    };

    this.getBestRoute = (src, srcAmount) => {
        var bestRoute = getBestRouteInternal(src, src, srcAmount, constants.PATH_LENGTH, []);

        if (bestRoute.length > 0) {
            assert(bestRoute[0].src == bestRoute[bestRoute.length - 1].dst);

            // Hack?
            bestRoute.expectedProfit = bestRoute[bestRoute.length - 1].dstAmount.sub(bestRoute[0].srcAmount);
        }

        return bestRoute;
    }

    this.getBestRate = (src, dst, srcAmount) => {
        return this.graph.get(src).get(dst);
    }
    
    // TODO add method to get direct rate
}

module.exports = {
    Model: Model
}