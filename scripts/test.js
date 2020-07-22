const ethers = require('ethers');
const legos = require('@studydefi/money-legos').legos;

const IERC20 = artifacts.require('IERC20');
const ISoloMargin = artifacts.require('ISoloMargin');
const IKyberNetworkProxy = artifacts.require('IKyberNetworkProxy');
const StrategyV1 = artifacts.require('StrategyV1');

async function test(callback) {
    const tokenA = await IERC20.at(legos.erc20.dai.address);

    const tokenB = await IERC20.at(legos.erc20.weth.address);

    const tokenC = await IERC20.at(legos.erc20.usdc.address);

    const soloMargin = await ISoloMargin.at(legos.dydx.soloMargin.address);

    const kyberNetworkProxy = await IKyberNetworkProxy.at(legos.kyber.network.address);

    const strategy = await StrategyV1.deployed();

    console.log('Strategy A balance: ' + await tokenA.balanceOf(strategy.address));

    const loanAmount = "0.01";
    const loanAmountWei = ethers.utils.parseUnits(loanAmount);

    console.log('Loan amount A (wei): ' + loanAmountWei);

    let soloMarginTokenABalance = await tokenA.balanceOf(soloMargin.address);

    console.log('SoloMargin A balance: ' + soloMarginTokenABalance);

    if (soloMarginTokenABalance < loanAmountWei) {
        throw new Error('soloMargin token A balance < loan amount');
    }

    const rate1 = await kyberNetworkProxy.getExpectedRate(
        tokenA.address,
        tokenB.address,
        loanAmountWei,
    );

    const amountB = Number(loanAmount) * rate1.expectedRate / (10**18); 

    const rate2 = await kyberNetworkProxy.getExpectedRate(
        tokenB.address,
        tokenC.address,
        ethers.utils.parseUnits(amountB.toString()),
    );

    const amountC = amountB * rate2.expectedRate / (10**18); 

    const rate3 = await kyberNetworkProxy.getExpectedRate(
        tokenC.address,
        tokenA.address,
        ethers.utils.parseUnits(amountC.toString()),
    );

    const amountA = amountC * rate3.expectedRate / (10**18);

    console.log(`${loanAmount} A => ${amountB} B => ${amountC} C => ${amountA} A`);

    let profit = amountA - Number(loanAmount);

    console.log('Expected profit: ' +  profit);

    if (profit <= 0) {
        throw new Error('not profitable');
    }

    let tx = await strategy.initiateFlashLoan(
        soloMargin.address,
        kyberNetworkProxy.address,
        tokenA.address,
        tokenB.address,
        tokenC.address,
        1000000,
        {
            gas: 5000000
        }
    );

    console.log(tx);

    console.log('Strategy A balance: ' + await tokenA.balanceOf(strategy.address));
}

module.exports = function(callback) {
    test(callback).catch(e => { console.log(e)});
}
