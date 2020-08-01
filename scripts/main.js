const ethers = require("@nomiclabs/buidler").ethers;
const legos = require('@studydefi/money-legos').legos;

const tokens = require('./tokens.js');
const model = require('./model.js');
const kyber = require('./kyber.js');
const strategy = require('./strategy.js');
const exec = require('./exec.js');
const constants = require('./constants.js');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

    let kbs = await kyber.load(legos.kyber.network.address);

    let startTokens = await tokens.TokenFactory.allTokens();

    let ethToken = tokens.TokenFactory.getEthToken();

    let ethRates = [];

    for (let token of startTokens) {
        if (token === ethToken) {
            continue;
        }

        ethRates.push(kbs.getExchangeRate(ethToken, token, constants.START_VALUE_ETH).then( (exchRate) => {
            console.log(`Fetching rate for ETH to ${token.symbol} - ${exchRate}`);

            mdl.updateRate(ethToken, token, exchRate);
        }));
    }

    await Promise.all(ethRates);

    let tokenRates = [];

    for (let t1 of startTokens) {
        if (t1 === ethToken) {
            continue;
        }
        
        for (let t2 of startTokens) {
            if (t1 === t2) {
                continue;
            }

            tokenRates.push(kbs.getExchangeRate(t1, t2, exc.calcSrcAmount(t1)).then( (exchRate) => {
                console.log(`Fetching rate for ${t1.symbol} to ${t2.symbol} - ${exchRate}`);

                mdl.updateRate(t1, t2, exchRate);
            }));
        }
    }

    await Promise.all(tokenRates);

    let onRateUpdate = async (exchange, src, dst, exchRate) => {
        console.log(`RATE UPDATE: ${exchange.name} ${src.symbol} ${dst.symbol} ${exchRate / (10**18)}`);

        mdl.updateRate(src, dst, exchRate);
    }

    kbs.listen(onRateUpdate);

    while (true) {
        for (let t of startTokens) {
            await exc.tryExecute(t);
        }

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