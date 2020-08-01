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

    for (let t1 of startTokens) {
        if (t1 === ethToken) {
            continue;
        }

        let tokenRates = [];
        
        for (let t2 of startTokens) {
            if (t1 === t2) {
                continue;
            }

            tokenRates.push(kbs.getExchangeRate(t1, t2, exc.calcSrcAmount(t1)).then( (exchRate) => {
                console.log(`Fetching rate for ${t1.symbol} to ${t2.symbol} - ${exchRate}`);

                mdl.updateRate(t1, t2, exchRate);

                if (t2 === ethToken) {
                    t1.ethRate = exchRate;
                }
            }));
        }

        await Promise.all(tokenRates);
    }

    let shouldExec = true;

    let onRateUpdate = async (sender, src, dst, usrSrcDelta, usrDstDelta) => {
        let srcToken = tokens.TokenFactory.getTokenByAddress(src);
        let dstToken = tokens.TokenFactory.getTokenByAddress(dst);

        if ((srcToken === undefined) || (dstToken === undefined)) {
            return;
        }

        let updateRate = async (s, d) => {
            let srcAmount = exc.calcSrcAmount(s);

            let exchRate = await kbs.getExchangeRate(s, d, srcAmount);

            console.log(`RATE UPDATE: ${s.symbol} ${d.symbol} ${exchRate / (10**18)}`);

            mdl.updateRate(s, d, exchRate);

            shouldExec = true;

            if (d === ethToken) {
                s.ethRate = exchRate;
            }
        }

        await Promise.all([
            updateRate(srcToken, dstToken),
            updateRate(dstToken, srcToken),
        ]);
    }

    kbs.listen(onRateUpdate);

    let i = 0;
    while (true) {
        if (shouldExec) {
            console.log(`EXECUTION LOOP ${i++}`);

            for (let t of startTokens) {
                await exc.tryExecute(t);
            }

            shouldExec = false;
        }

        await sleep(constants.EXECUTE_INTERVAL);
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