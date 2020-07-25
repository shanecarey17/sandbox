const ethers = require("@nomiclabs/buidler").ethers;
const axios = require('axios');
const legos = require('@studydefi/money-legos').legos;

const wallet = require('./wallet.js');
const tokens = require('./tokens.js');
const model = require('./model.js');
const kyber = require('./kyber.js');

const etherscanEndpoint = 'http://api.etherscan.io';
const etherscanApiKey = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';

const coinMarketCapEndpoint = 'https://pro-api.coinmarketcap.com';
const coinMarketCapApiKey = '50615d1e-cf23-4931-a566-42f0123bd7b8';

const kyberPrecision = 18;

const TEN = ethers.BigNumber.from(10);

exchRateCache = new Map();

uniswapPairCache = new Map();

let kyberContract; // Set in main()

// https://uniswap.org/docs/v2/smart-contracts/factory
// const uniswapFactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

// function updateCache(src, dst, rate) {
//     if (!exchRateCache.has(src)) {
//         exchRateCache.set(src, new Map());
//     }

//     exchRateCache.get(src).set(dst, rate);
// }

// async function simulateKyberTrade(src, dst, exchRate, srcAmount) {
//     // Returns dst amount
//     if (dst.decimals.gte(src.decimals)) {
//         return srcAmount.mul(exchRate).mul(TEN.pow(dst.decimals - src.decimals)).div(TEN.pow(kyberPrecision));
//     } else {
//         return srcAmount.mul(exchRate).div(TEN.pow(src.decimals - dst.decimals + kyberPrecision));
//     }
// }

// async function getExchangeRate(src, dst, srcAmount) {
//     if (!exchRateCache.has(src) || !exchRateCache.get(src).has(dst)) {
//         updateCache(src, dst, null);

//         let result = await kyberContract.getExpectedRate(src.contract.address, dst.contract.address, srcAmount);

//         if (result.expectedRate == 0) {
//             return null; //throw new Error('Unable to fetch rate');
//         }

//         updateCache(src, dst, result.expectedRate);

//         return result.expectedRate;
//     }

//     return exchRateCache.get(src).get(dst);
// }

// async function checkCache(src, dst, rate) {
//     updateCache(src, dst, rate);

//     for (const [src, dstMap] of exchRateCache.entries()) {
//         for (const [dst, exchRate] of dstMap.entries()) {
//             if (exchRate == null) {
//                 continue;
//             }

//             if (!exchRateCache.has(dst)) {
//                 continue;
//             }

//             let srcValueUSD = 100;
//             let fallbackTokensCount = 300;
//             let srcTokens = src.price == 0 ? fallbackTokensCount : (1 / src.price * srcValueUSD);

//             let srcAmount = TEN.pow(src.decimals).mul(Math.round(srcTokens));

//             let dstAmount = await simulateKyberTrade(src, dst, exchRate, srcAmount);

//             for (const [dst2, exchRate2] of exchRateCache.get(dst).entries()) {
//                 if (exchRate2 === null) {
//                     continue;
//                 }

//                 if (dst2 == src) {
//                     continue;
//                 }

//                 let dst2Amount = await simulateKyberTrade(dst, dst2, exchRate2, dstAmount);

//                 let exchRate3 = await getExchangeRate(dst2, src, dst2Amount);

//                 if (exchRate3 === null) {
//                     continue;
//                 }

//                 let srcReturn = await simulateKyberTrade(dst2, src, exchRate3, dst2Amount);

//                 let srcDenom = 10**src.decimals;
//                 let dstDenom = 10**dst.decimals;
//                 let dst2Denom = 10**dst2.decimals;

//                 let rateDenom = 10**18;

//                 let srcProfit = (srcReturn - srcAmount) / srcDenom;
//                 let srcProfitUSD = src.price * srcProfit;

//                 if (srcProfitUSD <= 0) {
//                     continue;
//                 }

//                 let srcAmountUSDDisplay = (src.price * srcTokens.toFixed(2)).toFixed(2);
//                 let srcTokenUSDDisplay = src.price.toFixed(2);

//                 const displayDecimals = 7;

//                 let srcAmountDisplay = (srcAmount / srcDenom).toFixed(displayDecimals);
//                 let exchRateDisplay = (exchRate / rateDenom).toFixed(displayDecimals);
//                 let exchRate2Display = (exchRate2 / rateDenom).toFixed(displayDecimals);
//                 let exchRate3Display = (exchRate3 / rateDenom).toFixed(displayDecimals);
//                 let dstAmountDisplay = (dstAmount / dstDenom).toFixed(displayDecimals);
//                 let dst2AmountDisplay = (dst2Amount / dst2Denom).toFixed(displayDecimals);
//                 let srcReturnDisplay = (srcReturn / srcDenom).toFixed(displayDecimals);

//                 console.log(`++\t\t=> ${srcAmountDisplay}\t${src.symbol} (${src.decimals}) ($${srcAmountUSDDisplay}@${srcTokenUSDDisplay}/ea.)`);
//                 console.log(`=> @${exchRateDisplay}\t=> ${dstAmountDisplay}\t${dst.symbol} (${dst.decimals})`);
//                 console.log(`=> @${exchRate2Display}\t=> ${dst2AmountDisplay}\t${dst2.symbol} (${dst2.decimals})`);
//                 console.log(`=> @${exchRate3Display}\t=> ${srcReturnDisplay}\t${src.symbol}`);

//                 // https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
//                 var colorFmt = srcProfit > 0 ? '\x1b[32m%s\x1b[0m' : '\x1b[31m%s\x1b[0m';
//                 console.log(colorFmt, `++\t\t\t=> ${srcProfit}\t${src.symbol}\t=> $${srcProfitUSD.toFixed(2)}`);
//                 console.log(`----------------------------------------------------------`);
//             }
//         }
//     }
// }

// async function calculateExchRate(src, dst, usrSrcDelta, usrDstDelta) {
//     // https://github.com/KyberNetwork/smart-contracts/blob/60245913be1574c581a567ea881e3f6e3daf0b20/contracts/Utils.sol#L34
//     if (dst.decimals.gte(src.decimals)) {
//         return usrDstDelta.mul(TEN.pow(kyberPrecision)).div(usrSrcDelta).div(TEN.pow(dst.decimals - src.decimals));
//     } else {
//         return usrDstDelta.mul((TEN.pow(src.decimals - dst.decimals + kyberPrecision))).div(usrSrcDelta);
//     }
// }

// async function getUniswapPairs() {
//     try {
//         let persisted = JSON.parse(fs.readFileSync('uniswap.json', 'utf8').toString().trim());

//         for (var i = 0; i < persisted.length; i++) {
//             let data = persisted[i];
//             let uniswapPair = await ethers.getContractAt('IUniswapV2Pair', data.address, wallet);
//             uniswapPairCache.set(new Set([data.token0, data.token1]), uniswapPair);
//         }

//         return;
//     } catch (err) {
//         console.log('Could not load uniswap pairs from file, fetching from network');
//     }

//     let persistedData = []

//     let uniswapFactory = await ethers.getContractAt('IUniswapV2Factory', uniswapFactoryAddress, wallet);

//     let uniswapPairsCount = await uniswapFactory.allPairsLength();
//     console.log(`UNISWAP PAIRS COUNT ${uniswapPairsCount}`);

//     for (var i = 0; i < uniswapPairsCount; i++) {
//         let pairAddress = await uniswapFactory.allPairs(i);

//         let uniswapPair = await ethers.getContractAt('IUniswapV2Pair', pairAddress, wallet);

//         let token0 = await tokens.TokenFactory.getTokenByAddress(await uniswapPair.token0());
//         let token1 = await tokens.TokenFactory(await uniswapPair.token1());

//         persistedData.push({
//             address: pairAddress,
//             token0: token0,
//             token1: token1
//         });

//         let token0Symbol = await getTokenName(token0);
//         let token1Symbol = await getTokenName(token1);

//         let token0Decimals = await getTokenDecimals(token0);
//         let token1Decimals = await getTokenDecimals(token1);

//         console.log(`Uniswap Pair ${token0Symbol} ${token1Symbol}`);

//         uniswapPairCache.set(new Set([token0, token1]), uniswapPair);

//         uniswapPair.on('Swap', async (sender, token0In, token1In, token0Out, token1Out, to) => {
//             let token0Amount = Math.max(token0In, token0Out) / (10**token0Decimals);
//             let token1Amount = Math.max(token1In, token1Out) / (10**token1Decimals);
//             console.log(`Uniswap SWAP ${token0Amount} ${token0Symbol} <=> ${token1Amount} ${token1Symbol}`)
//         });
//     }

//     fs.writeFileSync('uniswap.json', JSON.stringify(persistedData));
// }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const run = async () => {
    await tokens.TokenFactory.init();

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