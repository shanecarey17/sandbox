const ethers = require("@nomiclabs/buidler").ethers;
const legos = require('@studydefi/money-legos').legos;

const tokens = require('./tokens.js');
const model = require('./model.js');
const kyber = require('./kyber.js');
const strategy = require('./strategy.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const run = async () => {
    await tokens.TokenFactory.init();

    let strat = await strategy.create();

    let kyberSwap = await kyber.create(legos.kyber.network.address);

    let mdl = new model.Model(kyberSwap);

    kyberSwap.onSwap( function() { mdl.updateRate.apply(mdl, arguments); } );

    let currentBlock = await ethers.provider.getBlockNumber();

    ethers.provider.resetEventsBlock(currentBlock - 100);

    while (true) {
        mdl.findBestRate();

        await sleep(1000);
    }
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();