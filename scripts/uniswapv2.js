const assert = require('assert');
const fs = require('fs');
const readline = require('readline');
const debug = require('debug')('uniswap');

const ethers = require("@nomiclabs/buidler").ethers;

const constants = require('./constants.js');
const tokens = require('./tokens.js');
const wallet = require('./wallet.js');

const sortTokens = (t1, t2) => {
    return [t1, t2].sort((a, b) => {
        return a.contract.address < b.contract.address ? -1 : 1;
    });
}

const getKey = (t1, t2) => {
    // Uniswap pairs are unique by sort order
    return sortTokens(t1, t2).map((t) => t.contract.address).join('-');
}

const setPair = async (uniswapPairs, t1, t2, addressOrFactory) => {    
    let key = getKey(t1, t2);

    if (uniswapPairs.has(key)) {
        return;
    }

    let pairAddress = addressOrFactory;
    if (typeof addressOrFactory !== 'string') {
        pairAddress = await addressOrFactory.getPair(t1.contract.address, t2.contract.address);
    }

    if (pairAddress == constants.ZERO_ADDRESS) {
        console.log(`NO UNISWAP PAIR EXISTS FOR ${t1.symbol} ${t2.symbol}`);

        return;
    }

    let uniswapPair = await ethers.getContractAt('IUniswapV2Pair', pairAddress, wallet);

    let ordered = sortTokens(t1, t2);

    uniswapPair._token0 = ordered[0];
    uniswapPair._token1 = ordered[1];

    let [reserve0, reserve1, block] = await uniswapPair.getReserves();

    uniswapPair._reserve0 = reserve0;
    uniswapPair._reserve1 = reserve1;

    uniswapPairs.set(key, uniswapPair);
}

const loadPairsFromFile = async (uniswapFactory) => {
    let uniswapPairs = new Map();

    let rl = readline.createInterface({
        input: fs.createReadStream(constants.UNISWAP_PAIRS_FILENAME),
        crlfDelay: Infinity
    });

    let tasks = [];

    for await (const line of rl) {
        if (line.length == 0) {
            continue;
        }
        
        if (line.startsWith('#')) {
            continue;
        }

        let data = line.trim();
        let [t0, t1, address] = data.split(',');

        assert(t0 !== undefined);
        assert(t1 !== undefined);
        assert(address !== undefined);

        let token0 = tokens.TokenFactory.getTokenBySymbol(t0);
        let token1 = tokens.TokenFactory.getTokenBySymbol(t1);

        if (token0 === undefined || token1 === undefined) {
            continue;
        }

        tasks.push(setPair(uniswapPairs, token0, token1, address));

        console.log(`LOADED UNISWAP PAIR ${token0.symbol} ${token1.symbol}`);
    }

    await Promise.all(tasks);

    return uniswapPairs;
}

const writeFile = (uniswapPairs) => {
    let text = "";

    for (const [key, contract] of uniswapPairs.entries()) {
        text += `${contract._token0.symbol},${contract._token1.symbol},${contract.address}\n`;
    }

    fs.writeFileSync(constants.UNISWAP_PAIRS_FILENAME, text);
}

function UniswapV2(factoryContract, pairContracts) {
    this.factoryContract = factoryContract;
    this.pairContracts = pairContracts;

    this.getExchangeRate = (src, dst, srcAmount) => {
        let key = getKey(src, dst);

        if (!this.pairContracts.has(key)) {
            // debug(`No pair for ${src.symbol} ${dst.symbol}`);
            return constants.ZERO;
        }

        let pairContract = this.pairContracts.get(key);

        if (pairContract._reserve0 == 0 || pairContract._reserve1 == 0) {
            // debug(`Empty reserve ${sc.symbol} ${dst.symbol}`);
            return constants.ZERO;
        }

        let srcIdx = src == pairContract._token0 ? 0 : 1;

        let srcBalance = srcIdx == 0 ? pairContract._reserve0 : pairContract._reserve1;

        if (srcAmount.mul(13).gte(srcBalance.mul(10))) {
            debug(`${src.symbol} ${dst.symbol} src amount exceeds balance ${src.formatAmount(srcAmount)} * 1.3 >= ${src.formatAmount(srcBalance)}}`);
            return constants.ZERO; // Requiring trade size <= half to ensure rate is accurate, no math to prove it
        }

        // Math is done * 10^2 (to apply fee?)
        let srcAmountAfterFee = srcAmount.mul(1000).sub(srcAmount.mul(3));

        let preBalanceSrc = srcBalance.mul(1000);
        let preBalanceDst = (srcIdx == 1 ? pairContract._reserve0 : pairContract._reserve1).mul(1000);

        let postBalanceSrc = preBalanceSrc.add(srcAmountAfterFee);

        // b0 * b1 >= r0 * r1 

        let minPostBalanceDst = preBalanceSrc.mul(preBalanceDst).div(postBalanceSrc);

        let allowedOutDst = preBalanceDst.sub(minPostBalanceDst);

        allowedOutDst = allowedOutDst.div(1000);

        return allowedOutDst;
    }

    this.calcDstAmount = (src, dst, srcAmount) => {
        return this.getExchangeRate(src, dst, srcAmount);
    }

    this.listen = (callback) => {
        for (let [key, contract] of this.pairContracts.entries()) {
            contract.on('Sync', async (reserve0, reserve1) => {
                contract._reserve0 = reserve0;
                contract._reserve1 = reserve1;

                console.log(`UNISWAPV2 SYNC ${contract._token0.symbol} ${contract._token1.symbol} ${reserve0} ${reserve1}`);

                callback(contract._token0, contract._token1);
            });
        }
    }
}

module.exports = {
    load: async (tokens) => {
        let uniswapFactory = await ethers.getContractAt('IUniswapV2Factory', constants.UNISWAP_FACTORY_ADDRESS, wallet);

        let uniswapPairs = await loadPairsFromFile(uniswapFactory);

        let tasks = [];

        for (let t1 of tokens) {
            for (let t2 of tokens) {
                if (t1 === t2) {
                    continue;
                }

                tasks.push(setPair(uniswapPairs, t1, t2, uniswapFactory));

                console.log(`FETCHED UNISWAP PAIR ${t1.symbol} ${t2.symbol}`);
            }
        }

        await Promise.all(tasks);

        writeFile(uniswapPairs);

        console.log('LOADED UNISWAPV2 EXCHANGE');

        return new UniswapV2(uniswapFactory, uniswapPairs);
    }
}