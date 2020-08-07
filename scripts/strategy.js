const assert = require('assert');
const fs = require('fs');

const { ethers, deployments } = require("@nomiclabs/buidler");
const legos = require('@studydefi/money-legos').legos;

const wallet = require('./wallet.js');
const constants = require('./constants.js');

const testTokenBalances = new Map();
testTokenBalances.set('DAI', ethers.utils.parseEther('100'));
testTokenBalances.set('ETH', ethers.utils.parseEther('1.0'));
testTokenBalances.set('USDC', ethers.utils.parseEther('100'));

function Strategy(contract, balance, marginContract) {
    this.contract = contract;
    this.balance = balance;
    this.tokenBalances = new Map();
    this.marginBalances = new Map();

    // this.contract.on('LOG', function() {
    //     // TODO update balances and such
    //     // TODO make sure this is earliest hook
    // });

    this.getTokenBalance = async (token) => {
        if (testTokenBalances.has(token.symbol)) {
            return testTokenBalances.get(token.symbol);
        }

        return constants.ZERO;
        // if (this.tokenBalances.has(token)) {
        //     return this.tokenBalances.get(token);
        // }

        // let tokenBalance = await token.contract.balanceOf(this.contract.address);

        // this.tokenBalances.set(token, tokenBalance);

        // return tokenBalance;
    }

    this.getMarginBalance = async (token) => {
        if (this.marginBalances.has(token)) {
            return this.marginBalances.get(token);
        }

        let tokenBalance = await token.balanceOf(legos.dydx.soloMargin.address); // Special helper for ETH

        console.log(`MARGIN BALANCE ${token.symbol} ${tokenBalance / (10**token.decimals)}`);

        this.marginBalances.set(token, tokenBalance);

        return tokenBalance;
    }

    this.getAvailableFunds = async (token) => {
        return (await this.getTokenBalance(token)).add(await this.getMarginBalance(token));
    }

    this.executeTrade = async function(route) {
        // assert(route.length == 3, 'only 3 hops supported');

        // assert(route[0].dst == route[1].src, "invalid hop");
        // assert(route[1].dst == route[2].src, "invalid hop");
        // assert(route[2].dst == route[0].src, "invalid hop");

        console.log('MOCKING EXECUTION');

        return;

        // let tx = await strategy.initiateFlashLoan(
        //     legos.dydx.solo.address,
        //     legos.kyber.network.address,
        //     route[0].src.contract.address,
        //     route[1].src.contract.address,
        //     route[2].src.contract.address,
        //     route[1].src.srcAmount,
        //     {
        //         gasLimit: 30000 // 24454 in test
        //     }
        // );

        // let txDone = await tx.wait(); // Wait for mining

        // console.log(txDone);
    }
}

module.exports = {
    load: async () => {
        return new Strategy(undefined, undefined);

        // const deployed = await deployments.get("StrategyV1");

        // const contract = await ethers.getContractAt("StrategyV1", deployed.address);

        // let strategyBalance = await ethers.provider.getBalance(contract.address);

        // console.log(`Strategy deployed at ${contract.address} balance ${strategyBalance}`);

        // return new Strategy(contract, strategyBalance);
    }
}