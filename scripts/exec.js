const { ethers } = require('@nomiclabs/buidler');

const constants = require('./constants.js');

function printRoute(route) {
    console.log(`================================================================================`)
    
    let src = route[0].src;
    
    console.log(`ROUTE ${src.symbol}`);

    route.forEach( function(trade) {
        let srcAmountFmt = trade.src.formatAmount(trade.srcAmount).padEnd(constants.DISPLAY_PADDING);
        let dstAmountFmt = trade.dst.formatAmount(trade.dstAmount).padEnd(constants.DISPLAY_PADDING);
        let exchRateFmt = (trade.exchRate / (10**18)).toFixed(constants.DISPLAY_DECIMALS).padEnd(constants.DISPLAY_PADDING);

        console.log(`=> ${srcAmountFmt}\t${trade.src.symbol}\t@${exchRateFmt}\t=>\t${dstAmountFmt}\t${trade.dst.symbol}`);
    });


    var profit = route[route.length - 1].dstAmount - route[0].srcAmount;
    var profitFmt = src.formatAmount(profit).padEnd(constants.DISPLAY_PADDING);
    var profitUSDFmt = (Number(profitFmt) * src.price).toFixed(2);

    var colorFmt = profit > 0 ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
    console.log(colorFmt, `++ ${profitFmt}\t${src.symbol}\t$${profitUSDFmt}`);

    console.log(`--------------------------------------------------------------------------------`);
}

function Executor(strategy, model) {
    this.strategy = strategy;
    this.model = model;

    this.tradeInFlight = false;

    let calcSrcAmount = (src) => {
        // Calculate the amount in terms of the configured USD value
        let srcValueUSD = constants.START_VALUE_USD.toNumber();

        let srcAmount = BigInt(Math.floor(srcValueUSD / src.price * (10**src.decimals.toNumber())));

        return ethers.BigNumber.from(srcAmount.toString());
    }

    this.bootstrap = async (tokens) => {
        for (let t of tokens) {
            if (t.price == 0) {
                continue;
            }

            await this.model.getBestRoute(t, calcSrcAmount(t));
        }
    }

    this.tryExecute = async (src) => {
        // One trade at a time
        if (this.tradeInFlight) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: Trade in flight`);
            return;
        }

        // If there is no price info, skip for now
        console.log(src.price);
        if (src.price <= 0) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: Bad price ${src.symbol} ${src.price.toFixed(2)}`);
            return;
        }

        let srcAmount = calcSrcAmount(src);

        // Get the best route for this coin
        // has the side effect of populating the graph faster
        let bestRoute = this.model.getBestRoute(src, srcAmount);

        if (bestRoute.length == 0) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: No available trade`);
            return;
        }

        printRoute(bestRoute);

        // Check the balance of this coin is sufficient
        let srcBalance = await this.strategy.getAvailableFunds(src);

        if (srcBalance.lte(srcAmount)) {
            console.log(constants.CONSOLE_RED, `EXECUTE FAIL: Insufficient funds to trade ${src.symbol} (${srcBalance} < ${srcAmount})`);
            return;
        }

        // Make sure the reout profit exceeds the gas cost
        let gasCost = constants.GAS_PRICE.mul(constants.GAS_ESTIMATE);

        let profit = bestRoute.expectedProfit.sub(gasCost); // TODO to ETH

        if (profit.lte(0)) {
            console.log(constants.CONSOLE_RED, `EXECUTE ERROR: Profit does not cover gas (${profit.toString()} < ${gasCost.toString()})`);
            return;
        }

        // Do the trade
        this.strategy.executeTrade(bestRoute)
            .then( (tx) => {
                console.log(constants.CONSOLE_GREEN, 'TRANSACTION SUCCEEDED');
                console.log(tx);
            })
            .catch( (err) => {
                console.log(constants.CONSOLE_RED, 'TRANSACTION FAILED')
                console.log(err);
            })
            .finally( () => {
                tradeInFlight = false;
            });

        console.log(constants.CONSOLE_GREEN, `EXECUTE SUCCESS`);
    }
}

module.exports = {
    Executor: Executor
}