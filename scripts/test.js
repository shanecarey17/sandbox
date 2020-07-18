const legos = require('@studydefi/money-legos').legos;

const IERC20 = artifacts.require('IERC20');
const ISoloMargin = artifacts.require('ISoloMargin');
const IKyberNetworkProxy = artifacts.require('IKyberNetworkProxy');
const StrategyV1 = artifacts.require('StrategyV1');

async function test(callback) {
    const dai = await IERC20.at(legos.erc20.dai.address);

    const weth = await IERC20.at(legos.erc20.weth.address);

    const usdc = await IERC20.at(legos.erc20.usdc.address);

    const soloMargin = await ISoloMargin.at(legos.dydx.soloMargin.address);

    const kyberNetworkProxy = await IKyberNetworkProxy.at(legos.kyber.network.address);

    const strategy = await StrategyV1.deployed();

    console.log(strategy);

    let tx = await strategy.initiateFlashLoan(
        soloMargin.address,
        kyberNetworkProxy.address,
        dai.address,
        weth.address,
        usdc.address,
        1000000
    );

    console.log(tx);
}

module.exports = function(callback) {
    test(callback).catch(e => { console.log(e)});
}