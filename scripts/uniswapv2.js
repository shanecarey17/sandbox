const ethers = require("@nomiclabs/buidler").ethers;

const tokens = require('./tokens.js');

const uniswapFactoryAddress = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

async function getUniswapPairs() {
    try {
        let persisted = JSON.parse(fs.readFileSync('uniswap.json', 'utf8').toString().trim());

        for (var i = 0; i < persisted.length; i++) {
            let data = persisted[i];
            let uniswapPair = await ethers.getContractAt('IUniswapV2Pair', data.address, wallet);
            uniswapPairCache.set(new Set([data.token0, data.token1]), uniswapPair);
        }

        return;
    } catch (err) {
        console.log('Could not load uniswap pairs from file, fetching from network');
    }

    let persistedData = [];

    let uniswapFactory = await ethers.getContractAt('IUniswapV2Factory', uniswapFactoryAddress, wallet);

    let uniswapPairsCount = await uniswapFactory.allPairsLength();
    console.log(`UNISWAP PAIRS COUNT ${uniswapPairsCount}`);

    for (var i = 0; i < uniswapPairsCount; i++) {
        let pairAddress = await uniswapFactory.allPairs(i);

        let uniswapPair = await ethers.getContractAt('IUniswapV2Pair', pairAddress, wallet);

        let token0 = await tokens.TokenFactory.getTokenByAddress(await uniswapPair.token0());
        let token1 = await tokens.TokenFactory(await uniswapPair.token1());

        persistedData.push({
            address: pairAddress,
            token0: token0,
            token1: token1
        });

        let token0Symbol = await getTokenName(token0);
        let token1Symbol = await getTokenName(token1);

        let token0Decimals = await getTokenDecimals(token0);
        let token1Decimals = await getTokenDecimals(token1);

        console.log(`Uniswap Pair ${token0Symbol} ${token1Symbol}`);

        uniswapPairCache.set(new Set([token0, token1]), uniswapPair);

        uniswapPair.on('Swap', async (sender, token0In, token1In, token0Out, token1Out, to) => {
            let token0Amount = Math.max(token0In, token0Out) / (10**token0Decimals);
            let token1Amount = Math.max(token1In, token1Out) / (10**token1Decimals);
            console.log(`Uniswap SWAP ${token0Amount} ${token0Symbol} <=> ${token1Amount} ${token1Symbol}`)
        });
    }

    fs.writeFileSync('uniswap.json', JSON.stringify(persistedData));
}