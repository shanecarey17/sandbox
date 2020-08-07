const { ethers } = require('@nomiclabs/buidler');

const constants = require('./constants.js');
const tokens = require('./tokens.js');

function Executor(strategy, model) {
    this.strategy = strategy;
    this.model = model;

    this.tradeInFlight = false;

    let printRoute = (route) => {
        console.log(`================================================================================`);
        
        let src = route[0].src;
        
        console.log(`ROUTE ${src.symbol}`);

        route.forEach( function(trade) {
            let srcAmountFmt = trade.src.formatAmount(trade.srcAmount).padEnd(constants.DISPLAY_PADDING);
            let dstAmountFmt = trade.dst.formatAmount(trade.dstAmount).padEnd(constants.DISPLAY_PADDING);
            let exchRateFmt = (trade.exchRate / (10**18)).toFixed(constants.DISPLAY_DECIMALS).padEnd(constants.DISPLAY_PADDING);

            console.log(`=> ${srcAmountFmt}\t${trade.src.symbol}\t@${exchRateFmt}\t=>\t${dstAmountFmt}\t${trade.dst.symbol}`);
        });


        var profit = route[route.length - 1].dstAmount.sub(route[0].srcAmount);
        var profitFmt = src.formatAmount(profit).padEnd(constants.DISPLAY_PADDING);

        // let eth = tokens.TokenFactory.getEthToken();
        // let ethRate = src === eth ? ethers.utils.parseEther('1') : this.model.getBestRate(src, eth, profit); // profit as amt here is eh
        // let ethProfit = this.model.calcDstAmount(src, eth, ethRate, profit);
        // let ethProfitFmt = eth.formatAmount(ethProfit);

        // var profitUSDFmt = (ethProfitFmt * eth.price).toFixed(2);

        // if (constants.USE_USD_REFERENCE_PX) {
        //     profitUSDFmt = (Number(profitFmt) * src.price).toFixed(2);
        // }

        let ethProfitFmt = 0;

        let profitUSDFmt = (Number(profitFmt) * src.price).toFixed(2);

        var colorFmt = profit > 0 ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
        console.log(colorFmt, `++ ${profitFmt}\t${src.symbol}\t${ethProfitFmt} ETH - $${profitUSDFmt}`);

        console.log(`--------------------------------------------------------------------------------`);
    }

    this.calcSrcAmount = (src) => {
        if (constants.USE_USD_REFERENCE_PX) {
            if (src.price == 0) {
                console.log(`No price info for ${src.symbol} - default ${constants.FALLBACK_COIN_AMT}`);

                return constants.TEN.mul(constants.FALLBACK_COIN_AMT).mul(constants.TEN.pow(src.decimals));
            }

            return ethers.BigNumber.from(String(BigInt(Math.ceil(constants.START_VALUE_USD / src.price * 10**src.decimals.toNumber()))));
        }

        // let eth = tokens.TokenFactory.getEthToken();

        // if (src === eth) {
        //     return constants.START_VALUE_ETH;
        // }

        // let ethRate = this.model.getBestRate(eth, src, constants.START_VALUE_ETH);

        // return this.model.calcDstAmount(eth, src, ethRate, constants.START_VALUE_ETH);
    }

    this.tryExecute = async (src) => {
        // // One trade at a time
        // if (this.tradeInFlight) {
        //     console.log(constants.CONSOLE_RED, `EXECUTE FAIL: Trade in flight`);
        //     return;
        // }

        let srcAmount = this.calcSrcAmount(src);

        // Get the best route for this coin
        // has the side effect of populating the graph faster
        let bestRoute = this.model.getBestRoute(src, srcAmount);

        if (bestRoute.length == 0) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: No available trade ${src.symbol}`);
            return [];
        }

        printRoute(bestRoute);

        // Check the balance of this coin is sufficient
        let srcBalance = await this.strategy.getAvailableFunds(src);

        if (srcBalance.lte(srcAmount)) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: Insufficient funds to trade ${src.symbol} (${srcBalance} < ${srcAmount})`);
            return bestRoute;
        }

        // // Make sure the reout profit exceeds the gas cost
        // let gasCost = constants.GAS_PRICE.mul(constants.GAS_ESTIMATE);

        // let profit = bestRoute.expectedProfit.sub(gasCost); // TODO to ETH

        // if (profit.lte(0)) {
        //     console.log(constants.CONSOLE_RED, `EXECUTE ERROR: Profit does not cover gas (${profit.toString()} < ${gasCost.toString()})`);
        //     return bestRoute;
        // }

        // Do the trade
        this.tradeInFlight = true;
        this.strategy.executeTrade(bestRoute)
            .then( () => {
                console.log(constants.CONSOLE_GREEN, 'TRANSACTION SUCCEEDED');
            })
            .catch( (err) => {
                console.log(constants.CONSOLE_RED, 'TRANSACTION FAILED')
                console.log(err);
            })
            .finally( () => {
                this.tradeInFlight = false;
            });

        console.log(constants.CONSOLE_GREEN, `EXECUTE SUCCESS`);

        return bestRoute;
    }
}

module.exports = {
    Executor: Executor
}