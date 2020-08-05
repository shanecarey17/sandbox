const ethers = require("@nomiclabs/buidler").ethers;
const legos = require('@studydefi/money-legos').legos;

const tokens = require('./tokens.js');
const model = require('./model.js');
const strategy = require('./strategy.js');
const exec = require('./exec.js');
const constants = require('./constants.js');
const server = require('./server.js');

const kyber = require('./kyber.js');
const uniswapv2 = require('./uniswapv2.js');

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

    let allTokens = await tokens.TokenFactory.allTokens();

    let ethToken = tokens.TokenFactory.getEthToken();

    // Kyber

    // let kyberSwap = await kyber.load();

    // let fetchExchangeRate = (src, dst) => {
    //     return kyberSwap.getExchangeRate(src, dst, exc.calcSrcAmount(src)).then( (exchRate) => {
    //         console.log(`FETCHED rate for ${src.symbol} to ${dst.symbol} - ${exchRate}`);

    //         mdl.updateRate(src, dst, exchRate);

    //         if (dst === ethToken) {
    //             src.ethRate = exchRate;
    //         }

    //         return exchRate;
    //     });
    // }

    // let updateTokenRates = async (token) => {
    //     let tokenRates = [];

    //     await fetchExchangeRate(ethToken, token);
        
    //     for (let dst of allTokens) {
    //         tokenRates.push(fetchExchangeRate(token, dst));
    //     }

    //     await Promise.all(tokenRates);
    // };

    // let tokenQueue = [...allTokens];

    // for (let token of tokenQueue) {
    //     await updateTokenRates(token);
    // }

    // let prioritizeToken = (token) => {
    //     console.log(`PRIORITY TOKEN ${token.symbol}`);

    //     let index = tokenQueue.indexOf(token);
    //     tokenQueue.splice(index, 1);
    //     tokenQueue.unshift(token);
    // };

    // let onKyberUpdate = async (src, dst) => {
    //     let srcToken = tokens.TokenFactory.getTokenByAddress(src);
    //     let dstToken = tokens.TokenFactory.getTokenByAddress(dst);

    //     if (srcToken !== undefined) {
    //         prioritizeToken(srcToken);
    //     }

    //     if (dstToken !== undefined) {
    //         prioritizeToken(dstToken);
    //     }
    // };

    // kyberSwap.listen(onKyberUpdate);

    // Uniswap

    let uniswap = await uniswapv2.load(allTokens);

    uniswap.listen(console.log);

    // Main loop

    // while (true) {
    //     var token = tokenQueue[0];

    //     await updateTokenRates(token);

    //     tokenQueue.splice(0, 1);
    //     tokenQueue.push(token);

    //     let routes = [];

    //     for (let execToken of allTokens) {
    //         let route = await exc.tryExecute(execToken);

    //         if (route.length > 0) {
    //             routes.push(route);
    //         }
    //     }

    //     server.sendMessage({
    //         rates: mdl.serialize(),
    //         routes: routes.map((r) => {
    //             let src = r[0].src;

    //             let srcProfit = r[r.length - 1].dstAmount.sub(r[0].srcAmount);
    //             let ethProfit = mdl.calcDstAmount(r[0].src, ethToken, src.ethRate, srcProfit);
    //             let usdProfit = ethToken.formatAmount(ethProfit) * ethToken.price;

    //             return {
    //                 srcProfit: src.formatAmount(srcProfit),
    //                 ethProfit: ethToken.formatAmount(ethProfit),
    //                 usdProfit: usdProfit.toFixed(2),
    //                 trades: r.map((t) => {
    //                     return {
    //                         src: t.src.symbol,
    //                         dst: t.dst.symbol,
    //                         srcAmount: t.src.formatAmount(t.srcAmount),
    //                         dstAmount: t.dst.formatAmount(t.dstAmount),
    //                         exchRate: (t.exchRate / (10**18)).toFixed(constants.DISPLAY_DECIMALS),
    //                     }
    //                 })
    //             };
    //         })
    //     });

    //     await sleep(constants.EXECUTE_INTERVAL);
    // }
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();