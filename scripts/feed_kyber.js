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

const kyberPrecision = 10**18;

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

            let srcAmount = ethers.BigNumber.from(10).pow(srcDecimals).mul(7);

            if (!exchRateCache.has(dst) || !exchRateCache.get(dst).has(src)) {
                updateCache(dst, src, null);

                let result = await kyberContract.getExpectedRate(dst, src, srcAmount);

                updateCache(dst, src, result.expectedRate);

                continue;
            }

            let revExchRate = exchRateCache.get(dst).get(src);

            if (revExchRate === null) {
                continue;
            }

            let dstAmount;
            let srcReturn = 0;

            if (dstDecimals >= srcDecimals) {
                dstAmount = srcAmount * exchRate * (10**(dstDecimals - srcDecimals)) / kyberPrecision;
                srcReturn = dstAmount * revExchRate / (kyberPrecision * (10**(dstDecimals - srcDecimals)));
            } else {
                dstAmount = srcAmount * exchRate / (kyberPrecision * (10**(srcDecimals - dstDecimals)));
                srcReturn = dstAmount * revExchRate * (10**(dstDecimals - srcDecimals)) / kyberPrecision;
            }

            let srcDenom = 10**srcDecimals;
            let dstDenom = 10**dstDecimals;

            let srcProfit = (srcReturn - srcAmount) / srcDenom;
            let srcProfitUSD = srcPrice * srcProfit;

            console.log(`   ${srcAmount / srcDenom} ${srcSymbol} (${srcDecimals}) ($${srcPrice.toFixed(2)})`);
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

        let exchRate;

        // https://github.com/KyberNetwork/smart-contracts/blob/60245913be1574c581a567ea881e3f6e3daf0b20/contracts/Utils.sol#L34
        if (dstDecimals >= srcDecimals) {
            exchRate = usrDstDelta * kyberPrecision / (usrSrcDelta * (10**(dstDecimals - srcDecimals)));
        } else {
            exchRate = usrDstDelta * kyberPrecision * (10**(srcDecimals - dstDecimals)) / usrSrcDelta;
        }

        console.log(`${time.toISOString()} ${sender} ${srcSymbol} ${dstSymbol} ${usrSrcDelta} ${usrDstDelta} ${exchRate}`);

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