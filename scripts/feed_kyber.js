const ethers = require("@nomiclabs/buidler").ethers;
const axios = require('axios');
const legos = require('@studydefi/money-legos').legos;

const fs = require('fs');
const mnemonic = fs.readFileSync('.secret', 'utf8').toString().trim();

const etherscanEndpoint = 'http://api.etherscan.io';
const etherscanApiKey = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';

const coinMarketCapEndpoint = 'https://pro-api.coinmarketcap.com';
const coinMarketCapApiKey = '50615d1e-cf23-4931-a566-42f0123bd7b8';

const wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(ethers.provider);

const kyberPrecision = 18;

const TEN = ethers.BigNumber.from(10);

exchRateCache = new Map();

tokenNameCache = new Map();
tokenNameCache.set('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 'Eth');

tokenDecimalsCache = new Map();
tokenDecimalsCache.set('0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', 18);

tokenPriceCache = new Map();

let kyberContract; // Set in main()

function sleep(s) {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}

async function fetchTokenPrices() {
    while (true) {
        let url = `${coinMarketCapEndpoint}/v1/cryptocurrency/listings/latest`
        let response = await axios.get(url, {
            headers: {
                'X-CMC_PRO_API_KEY': coinMarketCapApiKey
            }
        });

        let data = response.data.data;

        for (let coin of data) {
            tokenPriceCache.set(coin.symbol, coin.quote.USD.price);
        }

        await sleep(60);
    }
}

async function getTokenPrice(token) {
    if (tokenPriceCache.has(token)) {
        return tokenPriceCache.get(token);
    }

    return 0
}

async function getTokenDecimals(token) {
    if (tokenDecimalsCache.has(token)) {
        return tokenDecimalsCache.get(token);
    }

    let tokenContract = await ethers.getContractAt('ERC20', token, wallet);

    let decimals;

    try {
        decimals = await tokenContract.decimals();
    } catch (err) {
        console.log(`FAILED TO GET DECIMALS FOR ${token}, default 18 will be used`);

        decimals = 18;
    }

    tokenDecimalsCache.set(token, decimals);

    return decimals;
}

async function getTokenName(token) {
    if (tokenNameCache.has(token)) {
        return tokenNameCache.get(token);
    }

    let symbol = '';

    try {
        let tokenContract = await ethers.getContractAt('ERC20', token, wallet);
        symbol = await tokenContract.symbol();
    } catch (err) {
        console.log(`Failed to fetch symbol from contract for ${token}, falling back to etherscan`);

        let url = `${etherscanEndpoint}/api?module=contract&action=getsourcecode&address=${token}&apikey=${etherscanApiKey}`;
        
        let response = await axios.get(url);

        if (response.data.status != '0') {
            symbol = response.data.result[0].ContractName;
        }
    }

    if (symbol == '') {
        symbol = token;
    }

    tokenNameCache.set(token, symbol);

    return symbol;
}

function updateCache(src, dst, rate) {
    if (!exchRateCache.has(src)) {
        exchRateCache.set(src, new Map());
    }

    exchRateCache.get(src).set(dst, rate);
}

async function checkCache(src, dst, rate) {
    updateCache(src, dst, rate);

    for (const [src, dstMap] of exchRateCache.entries()) {
        for (const [dst, exchRate] of dstMap.entries()) {
            let srcDecimals = await getTokenDecimals(src);
            let dstDecimals = await getTokenDecimals(dst);

            let srcSymbol = await getTokenName(src);
            let dstSymbol = await getTokenName(dst);

            let srcPrice = await getTokenPrice(srcSymbol); // TODO organize coins better

            if (srcPrice == 0) {
                continue;
            }

            let srcTokens = 1 / srcPrice * 10; // Change 10 to adjust amount
            let srcAmount = TEN.pow(srcDecimals).mul(Math.round(srcTokens));

            let dstAmount;

            // Careful of overflow
            if (dstDecimals >= srcDecimals) {
                dstAmount = srcAmount.mul(exchRate).mul(TEN.pow(dstDecimals - srcDecimals)).div(TEN.pow(kyberPrecision));
            } else {
                dstAmount = srcAmount.mul(exchRate).div(TEN.pow(srcDecimals - dstDecimals + kyberPrecision));
            }

            if (!exchRateCache.has(dst) || !exchRateCache.get(dst).has(src)) {
                updateCache(dst, src, null);

                let result = await kyberContract.getExpectedRate(dst, src, dstAmount);

                if (result.expectedRate == 0) {
                    continue;
                }

                updateCache(dst, src, result.expectedRate);

                continue;
            }

            let revExchRate = exchRateCache.get(dst).get(src);

            if (revExchRate === null) {
                continue;
            }

            let srcReturn;

            if (dstDecimals >= srcDecimals) {
                srcReturn = dstAmount.mul(revExchRate).div(TEN.pow(dstDecimals - srcDecimals + kyberPrecision));
            } else {
                srcReturn = dstAmount.mul(revExchRate).mul(TEN.pow(dstDecimals - srcDecimals)).div(TEN.pow(kyberPrecision));
            }

            let srcDenom = 10**srcDecimals;
            let dstDenom = 10**dstDecimals;

            let srcProfit = (srcReturn - srcAmount) / srcDenom;
            let srcProfitUSD = srcPrice * srcProfit;

            let srcAmountUSDDisplay = (srcPrice * srcTokens).toFixed(2);
            let srcTokenUSDDisplay = srcPrice.toFixed(2);

            console.log(`   ${srcAmount / srcDenom} ${srcSymbol} (${srcDecimals}) ($${srcAmountUSDDisplay}@${srcTokenUSDDisplay}/ea.)`);
            console.log(`=> @${exchRate / dstDenom} => ${dstAmount / dstDenom} ${dstSymbol} (${dstDecimals})`);
            console.log(`=> @${revExchRate / srcDenom} => ${srcReturn / srcDenom} ${srcSymbol}`);

            var colorFmt; // https://stackoverflow.com/questions/9781218/how-to-change-node-jss-console-font-color
            if (srcProfit > 0) {
                   colorFmt = '\x1b[32m%s\x1b[0m';
            } else {
                colorFmt = '\x1b[31m%s\x1b[0m';
            }

            console.log(colorFmt, `++ ${srcProfit} ${srcSymbol} = $${srcProfitUSD.toFixed(2)}`);
            console.log(`----------------------------------------------------------`);
        }
    }
}

const run = async () => {
    kyberContract = await ethers.getContractAt('IKyberNetworkProxy', legos.kyber.network.address, wallet);

    let time = new Date();
    console.log(`${time.toISOString()} sender src dst usrSrcDelta usrDstDelta`);

    let priceTaskPromise = fetchTokenPrices().catch( (err) => { console.log(err); });

    kyberContract.on('ExecuteTrade', async (sender, src, dst, usrSrcDelta, usrDstDelta) => {
        let time = new Date();

        let srcSymbol = await getTokenName(src);
        let dstSymbol = await getTokenName(dst);

        let srcDecimals = await getTokenDecimals(src);
        let dstDecimals = await getTokenDecimals(dst);

        var exchRate;

        // https://github.com/KyberNetwork/smart-contracts/blob/60245913be1574c581a567ea881e3f6e3daf0b20/contracts/Utils.sol#L34
        if (dstDecimals >= srcDecimals) {
            exchRate = usrDstDelta.mul(TEN.pow(kyberPrecision)).div(usrSrcDelta).div(TEN.pow(dstDecimals - srcDecimals));
        } else {
            exchRate = usrDstDelta.mul((TEN.pow(srcDecimals - dstDecimals + kyberPrecision))).div(usrSrcDelta);
        }

        await checkCache(src, dst, exchRate);
    });

    let currentBlock = await ethers.provider.getBlockNumber();

    ethers.provider.resetEventsBlock(currentBlock - 100);

    await priceTaskPromise;
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();