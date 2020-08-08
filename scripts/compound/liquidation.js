const axios = require('axios');
const fs = require('fs');

const ethers = require("@nomiclabs/buidler").ethers;

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';

const wallet = require('./../wallet.js');
const tokens = require('./../tokens.js');

const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));
const CTOKEN_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken.json'));

const ADDRESS_TOKENS_SLOT = 13;

const getAccounts = async () => {
    let allAccounts = [];

    let response = await axios.get(`https://api.compound.finance/api/v2/account?page_size=1000`);

    for (let account of response.data.accounts) {
        allAccounts.push(account);
    }

    console.log(`EXPECTED ACCOUNTS ${response.data.pagination_summary.total_entries}`);

    let tasks = [];

    console.log(response.data.pagination_summary.total_pages);

    for (var i = 1; i < response.data.pagination_summary.total_pages; i++) {
        let func = async () => {
            let r = await axios.get(`https://api.compound.finance/api/v2/account?page_size=1000&page_number=${i + 1}`);

            for (let account of r.data.accounts) {
                allAccounts.push(account);
            }
        };

        tasks.push(func());
    }

    await Promise.all(tasks);

    console.log(`TOTAL ACCOUNTS ${allAccounts.length}`);

    return allAccounts;
}

const run = async () => {
    await tokens.TokenFactory.init();

    console.log('READY LITTYQUIDATOR 1');

    // Load contracts from mainnet
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, wallet);

    await comptrollerContract.deployed();

    let markets = await comptrollerContract.getAllMarkets();

    for (let marketAddress of markets) {
        let cTokenContract = new ethers.Contract(marketAddress, CTOKEN_ABI, wallet);

        await cTokenContract.deployed();

        let underlyingToken;

        try {
            let underlying = await cTokenContract.underlying();

            underlyingToken = await tokens.TokenFactory.getTokenByAddress(underlying);
        } catch (err) {
            underlyingToken = tokens.TokenFactory.getEthToken();
        }

        let exchangeRate = await cTokenContract.exchangeRateStored();

        console.log(`cTOKEN ${underlyingToken.symbol} exchangeRate ${exchangeRate.toString()}`);
    }

    // Fetch accounts from REST service
    //let allAccounts = await getAccounts();

    // Listen
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();