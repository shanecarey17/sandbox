const assert = require('assert');
const fs = require('fs');
const readline = require('readline');

const ethers = require("@nomiclabs/buidler").ethers;

const constants = require('./constants.js');
const tokens = require('./tokens.js');
const wallet = require('./wallet.js');

const getKey = (t1, t2) => {
    // Uniswap paira are unique by sort order
    let arr = [t1, t2];
    arr.sort((a, b) => {
        return t1.address > t2 ? 0 : 1;
    });
    return arr;
}

const setPair = async (uniswapPairs, t1, t2, addressOrFactory) => {
    debugger;
    
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

    uniswapPair._token0 = key[0];
    uniswapPair._token1 = key[1];

    uniswapPairs.set(key, uniswapPair);

    console.log(`ADDING UNISWAP PAIR ${t1.symbol} ${t2.symbol}`);
}

const loadPairsFromFile = async (uniswapFactory) => {
    let uniswapPairs = new Map();

    let rl = readline.createInterface({
        input: fs.createReadStream(constants.UNISWAP_PAIRS_FILENAME),
        crlfDelay: Infinity
    });

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

        await setPair(uniswapPairs, token0, token1, address);

        console.log(`LOADED UNISWAP PAIR ${token0.symbol} ${token1.symbol}`);
    }

    return uniswapPairs;
}

const writeFile = (uniswapPairs) => {
    let text = "";

    for (const [key, contract] of uniswapPairs.entries()) {
        text += `${key[0].symbol},${key[1].symbol},${contract.address}\n`;
    }

    debugger;

    fs.writeFileSync(constants.UNISWAP_PAIRS_FILENAME, text);
}

function UniswapV2(factoryContract, pairContracts) {
    this.factoryContract = factoryContract;
    this.pairContracts = pairContracts;

    this.getExchangeRate = async (src, dst, srcAmount) => {
        let pairContract = this.exchangeContracts.get(getKey(src, dst));

        assert(pairContract !== undefined);

        let srcPx = await pairContract.cumulativePrice0Last();
        let dstPx = await pairContract.cumulativePrice1last();

        return;
    }

    this.listen = (callback) => {
        for (let [key, contract] of this.pairContracts.entries()) {
            contract.on('Swap', async (sender, amount0In, amount1In, amount0Out, amount1Out, to) => {
                console.log('UNISWAPV2 EVENT');
                
                let srcToken = amount0In > amount1In ? contract._token0 : contract._token1;
                let dstToken = amount0In > amount1In ? contract._token1 : contract._token0;

                // TODO calculate rate

                console.log(`Uniswap SWAP ${srcToken.symbol} <=> ${dstToken.symbol}`);

                //callback(srcToken, dstToken);
            });

            contract.on('Sync', async (reserve0, reserve1) => {
                contract._reserve0 = reserve0;
                contract._reserve1 = reserve1;

                console.log(`UNISWAPV2 SYNC ${contract._token0.symbol} ${contract._token1.symbol} ${reserve0} ${reserve1}`);
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