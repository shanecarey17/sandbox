const axios = require('axios');
const fs = require('fs');
const obj2csv = require('obj2csv');

const bre = require('@nomiclabs/buidler');
const {ethers} = bre;

const constants = require('../constants.js');
const tokens = require('../tokens.js');

const etherscanUrl = 'http://api.etherscan.io/api';

const COMPTROLLER_ADDRESS = ethers.utils.getAddress('0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b');
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));
const CTOKEN_V1_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken_v1.json'));

module.exports = async () => {
    console.log('RUNNING SCRIPT');

    await tokens.TokenFactory.init();

    let ethToken = tokens.TokenFactory.getEthToken();
    console.log(`ETH PRICE ${ethToken.price}`);

    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, ethers.provider);

    let markets = await comptrollerContract.getAllMarkets();

    console.log(markets);

    let marketSymbols = {};

    let allLiquidations = [];
    for (let market of markets) {
        let marketContract = new ethers.Contract(market, CTOKEN_V1_ABI, ethers.provider);

        let tokenAddress;
        try {
            tokenAddress = await marketContract.underlying();
        } catch (err) {
            tokenAddress = tokens.TokenFactory.getEthToken();
        }

        let token = await tokens.TokenFactory.loadToken(tokenAddress);

        console.log(`${token.symbol} PRICE ${token.price}`);

        let logsResult = await axios.get(etherscanUrl, {
            params: {
                apiKey: constants.ETHERSCAN_API_KEY,
                module: 'logs',
                action: 'getLogs',
                address: market,
                fromBlock: 10750000,
                toBlock: 'latest',
                topic0: '0x298637f684da70674f26509b10f07ec2fbc77a335ab1e7d6215a4b2484d8bb52',
            }
        });

        for (let log of logsResult.data.result) {
            let event = marketContract.interface.parseLog(log);

            let gasCost = liqData.gasPrice.mul(liqData.gasUsed);
            let estimatedRev = liqData.repayAmount.mul(5).div(100);
            let estimatedEthRev = Number(liqData.token.formatAmount(estimatedRev)) * liqData.token.price / ethToken.price;
            estimatedEthRev = ethers.utils.parseEther(String(estimatedEthRev).substring(0, 18));
            let estimatedProfit = estimatedEthRev.sub(gasCost);

            let liqData = {
                token,
                blockNumber: ethers.BigNumber.from(log.blockNumber),
                liquidator: event.args.liquidator,
                borrowMarket: marketContract.address,
                collateralMarket: event.args.cTokenCollateral,
                repayAmount: ethers.BigNumber.from(event.args.repayAmount),
                seizeTokens: ethers.BigNumber.from(event.args.seizeTokens),
                gasPrice: ethers.BigNumber.from(log.gasPrice),
                gasUsed: ethers.BigNumber.from(log.gasUsed),
                gasCost,
                estimatedRev,
                estimatedEthRev,
                estimatedProfit,
            };

            allLiquidations.push(liqData);
        }

        // etherscan rate limit
        await new Promise((resolve, reject) => setTimeout(resolve, 3));
    }

    allLiquidations.sort((a, b) => a.blockNumber.sub(b.blockNumber).gt(0) ? 1 : -1);

    obj2csv
};
