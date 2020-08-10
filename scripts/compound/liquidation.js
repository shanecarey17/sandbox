const axios = require('axios');
const fs = require('fs');
const util = require('util');

const ethers = require("@nomiclabs/buidler").ethers;

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';

const wallet = require('./../wallet.js');
const tokens = require('./../tokens.js');
const constants = require('./../constants.js');

const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));
const CTOKEN_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken.json'));

const getMarkets = async (comptrollerContract) => {
    let markets = await comptrollerContract.getAllMarkets();

    let allMarkets = {};

    for (let marketAddress of markets) {
        let cTokenContract = new ethers.Contract(marketAddress, CTOKEN_ABI, wallet);

        await cTokenContract.deployed();

        let token = await tokens.TokenFactory.loadToken(cTokenContract.address);

        let underlyingToken;

        try {
            let underlying = await cTokenContract.underlying();

            underlyingToken = await tokens.TokenFactory.getTokenByAddress(underlying);
        } catch (err) {
            underlyingToken = tokens.TokenFactory.getEthToken();
        }

        let exchangeRate = await cTokenContract.exchangeRateStored();

        let totalSupply = await cTokenContract.totalSupply();
        let totalBorrows = await cTokenContract.totalBorrows();

        console.log(`cTOKEN ${underlyingToken.symbol} 
            exchangeRate ${exchangeRate.toString()} 
            totalSupply ${totalSupply.toString()}`);

        cTokenContract._data = new Proxy({
            exchangeRate: exchangeRate,
            totalSupply: totalSupply,
            token: token,
            underlyingToken: underlyingToken,
            totalBarrows: totalBorrows,
        }, {
            get: (target, name) => name in target ? target[name] : {
                tokens: constants.ZERO,
                borrows: constants.ZERO,
        }});

        allMarkets[cTokenContract.address] = cTokenContract;
    }

    return allMarkets;
}

const listen = (markets) => {
    for (let [address, contract] of Object.entries(markets)) {
        let cTokenContract = contract;

        cTokenContract.on('Mint', (minter, mintAmount, mintTokens) => {
            // User supplied mintAmount to the pool and receives mintTokens cTokens in exchange
            // Followed by Transfer event

            let minterData = cTokenContract._data[minter];

            cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.add(mintTokens);

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] MINT - ${minter} 
                ${cTokenContract._data.underlyingToken.formatAmount(mintAmount)} ${cTokenContract._data.underlyingToken.symbol} deposited
                ${mintTokens.toString()} ${cTokenContract._data.token.symbol} minted
                    ${cTokenContract._data.token.formatAmount(cTokenContract._data.totalSupply)} totalSupply`);
        });

        cTokenContract.on('Redeem', (redeemer, redeemAmount, redeemTokens) => {
            // User redeemed redeemTokens cTokens for redeemAmount underlying
            // Preceded by Transfer event
            // Nothing to do here

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] REDEEM - ${redeemer} 
                ${cTokenContract._data.token.formatAmount(redeemAmount)} ${cTokenContract._data.token.symbol} redeemed
                ${cTokenContract._data.underlyingToken.formatAmount(redeemTokens)} ${cTokenContract._data.underlyingToken.symbol} returned`);
        });

        cTokenContract.on('Borrow', (borrower, borrowAmount, accountBorrows, totalBorrows) => {
            // User borrowed borrowAmount tokens, new borrow balance is accountBorrows
            let borrowerData = cTokenContract._data[borrower];

            borrowerData.borrows = accountBorrows;

            cTokenContract._data.totalBorrows = totalBorrows;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] BORROW ${borrower} 
                ${cTokenContract._data.underlyingToken.formatAmount(borrowAmount)} borrowed
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} outstanding`);
        });

        cTokenContract.on('RepayBorrow', (payer, borrower, repayAmount, accountBorrows, totalBorrows) => {
            // User repaid the borrow with repayAmount

            let borrowerData = cTokenContract._data[borrower];

            borrowerData.borrows = accountBorrows;

            cTokenContract._data.totalBorrows = totalBorrows;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] REPAY_BORROW - ${borrower}
                ${cTokenContract._data.underlyingToken.formatAmount(repayAmount)} repaid
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} outstanding`)
        });

        cTokenContract.on('LiquidateBorrow', (liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens) => {
            // Another account liquidated the borrowing account by repaying repayAmount and seizing seizeTokens of cTokenCollateral

            let borrowerData = cTokenContract._data[borrower];

            borrowerData.borrows = borrowerData.borrows.sub(repayAmount);

            let collateralContract = allMarkets[cTokenCollateral];

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] LIQUIDATE_BORROW - ${liquidator} ${borrower}
                ${cTokenContract._data.underlyingToken.formatAmount(repayAmount)} ${cTokenContract._data.underlyingToken.symbol} repaid
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} ${cTokenContract._data.underlyingToken.symbol} outstanding
                ${collateralContract._data.token.formatAmount(seizeTokens.toString())} ${collateralContract._data.token.symbol} collateral seized`);
        });

        cTokenContract.on('Transfer', (src, dst, amount) => {
            // Token balances were adjusted by amount, if src or dst is the contract itself update totalSupply

            if (src == cTokenContract.address) {
                cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.sub(amount);

                cTokenContract._data[dst].tokens = cTokenContract._data[dst].tokens.add(amount);

            } else if (dst == cTokenContract.address) {
                cTokenContract._data[src].tokens = cTokenContract._data[src].tokens.sub(amount);

                cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.add(amount);

            } else {
                cTokenContract._data[src].tokens = cTokenContract._data[src].tokens.sub(amount);

                cTokenContract._data[dst].tokens = cTokenContract._data[dst].tokens.add(amount);
            }

            let srcFmt = src == cTokenContract.address ? 'SELF' : src;
            let dstFmt = dst == cTokenContract.address ? 'SELF' : dst;

            let underlying = cTokenContract._data.underlyingToken;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] TRANSFER ${srcFmt} ${dstFmt}
                ${amount.toString()} c${cTokenContract._data.underlyingToken.symbol} transferred
                    ${srcFmt} ${cTokenContract._data.token.formatAmount(cTokenContract._data[src].tokens)} ${cTokenContract._data.token.symbol} balance
                    ${dstFmt} ${cTokenContract._data.token.formatAmount(cTokenContract._data[dst].tokens)} ${cTokenContract._data.token.symbol} balance
                    ${cTokenContract._data.token.formatAmount(cTokenContract._data.totalSupply)} ${cTokenContract._data.token.symbol} totalSupply`);
        });
    }
}

const getAccounts = async (markets, blockNumber) => {
    let allAccounts = [];

    let url = `https://api.compound.finance/api/v2/account`;

    let reqData = {
        'min_borrow_value_in_eth': { value: '0.1' },
        'page_size': 1000
    }

    let response = await axios.post(url, JSON.stringify(reqData));

    console.log(url);

    for (let account of response.data.accounts) {
        allAccounts.push(account);
    }

    console.log(`EXPECTED ACCOUNTS ${response.data.pagination_summary.total_entries}`);

    let tasks = [];

    for (var i = 1; i < response.data.pagination_summary.total_pages; i++) {
        let func = async () => {
            let page_url = `${url}?page_number=${i + 1}`;

            let r = await axios.post(page_url, JSON.stringify(reqData));

            console.log(page_url);

            for (let account of r.data.accounts) {
                allAccounts.push(account);
            }
        };

        tasks.push(func());
    }

    await Promise.all(tasks);

    // Load into memory, print biggest for eye candy
    var biggestAccount = undefined;

    for (let account of allAccounts) {
        console.log(`ACCOUNT ${account.address} -- `);

        for (let acctToken of account.tokens) {
            let market = markets[ethers.utils.getAddress(acctToken.address)]; // checksum case

            let tracker = market._data[account.address];

            let exchangeRate = market._data.exchangeRate;

            let cToken = market._data.token;
            let underlying = market._data.underlyingToken;

            tracker.tokens = underlying.parseAmount(acctToken.supply_balance_underlying.value)
                .div(exchangeRate.div(constants.TEN.pow(underlying.decimals)));

            tracker.borrows = underlying.parseAmount(acctToken.borrow_balance_underlying.value);

            // keep tabs
            console.log(`++ ${cToken.formatAmount(tracker.tokens)} ${cToken.symbol} supplied`);
            console.log(`++ ${underlying.formatAmount(tracker.borrows)} ${underlying.symbol} borrowed`);
        }

        if (biggestAccount === undefined) {
            biggestAccount = account;
        } else {
            if (biggestAccount.total_borrow_value_in_eth.value < account.total_borrow_value_in_eth.value) {
                biggestAccount = account;
            }
        }
    }

    console.log(util.inspect(biggestAccount, {showHidden: false, depth: null}));

    return allAccounts.length;
}

const getBlockNumber = () => {
    return new Promise((resolve, reject) => {
        ethers.provider.once('block', (blockNumber) => {
            resolve(blockNumber);
        });
    });
}

const run = async () => {
    await tokens.TokenFactory.init();

    console.log('READY LITTYQUIDATOR 1');

    // Load contracts from mainnet
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, wallet);

    await comptrollerContract.deployed();

    let markets = await getMarkets(comptrollerContract);

    let blockNumber = await getBlockNumber();

    // Fetch accounts from REST service
    let numAccounts = await getAccounts(markets, blockNumber);

    console.log(`LOADED ${numAccounts} ACCOUNTS`);

    // Start playing events from snapshot
    ethers.provider.resetEventsBlock(blockNumber);

    listen(markets);
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();