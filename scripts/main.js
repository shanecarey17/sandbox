const ethers = require("@nomiclabs/buidler").ethers;
const legos = require('@studydefi/money-legos').legos;

const tokens = require('./tokens.js');
const model = require('./model.js');
const kyber = require('./kyber.js');
const strategy = require('./strategy.js');
const exec = require('./exec.js');

const run = async () => {
    process.on('unhandledRejection', (err) => { 
        console.log(err); 
        process.exit(); 
    });

    const signer = (await ethers.getSigners())[0];
    const signerAddress = await signer.getAddress();
    const balance = await signer.getBalance();

    console.log(`SIGNER BALANCE: ${signerAddress} ${balance / (10**18)} ETH`);

    await tokens.TokenFactory.init();

    let str = await strategy.load();

    let mdl = new model.Model();

    let exc = new exec.Executor(str, mdl);

    let onRateUpdate = async (exchange, src, dst, exchRate) => {
        console.log(`RATE UPDATE: ${exchange.name} ${src.symbol} ${dst.symbol} ${exchRate / (10**18)}`);

        mdl.updateRate(exchange, src, dst, exchRate);

        await exc.tryExecute(src);
    }

    let kbs = await kyber.load(legos.kyber.network.address, onRateUpdate);

    mdl.addExchange(kbs);

    if (false) {
        // TODO config
        // Start from a while ago
        // TODO fetch rsates instead of loading historical
        let currentBlock = await ethers.provider.getBlockNumber();
        ethers.provider.resetEventsBlock(currentBlock - 100);
    }

    let startTokens = await tokens.TokenFactory.allTokens();

    await exc.bootstrap(startTokens);
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();