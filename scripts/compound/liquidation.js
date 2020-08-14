const axios = require('axios');
const assert = require('assert');
const fs = require('fs');
const util = require('util');

const ethers = require("@nomiclabs/buidler").ethers;

const wallet = require('./../wallet.js');
const tokens = require('./../tokens.js');
const constants = require('./../constants.js');

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));

const CTOKEN_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken.json'));

const PRICE_ORACLE_ADDRESS = '0xDDc46a3B076aec7ab3Fc37420A8eDd2959764Ec4';
const PRICE_ORACLE_ABI = JSON.parse(fs.readFileSync('abi/compound/priceoracle.json'));

const V1_ORACLE_ADDRESS = '0x02557a5E05DeFeFFD4cAe6D83eA3d173B272c904';
const V1_ORACLE_ABI = JSON.parse(fs.readFileSync('abi/compound/v1oracle.json'));

const getLiquidationRatio = (account, markets) => {
    let totalBorrowedEth = constants.ZERO;
    let totalSuppliedEth = constants.ZERO;

    let ethToken = tokens.TokenFactory.getEthToken();

    for (let [marketAddress, accountMarket] of Object.entries(account)) {
        if (marketAddress === 'address') {
            continue; // TODO less hacky
        }

        let marketData = markets[marketAddress]._data;

        let marketBorrowedEth = accountMarket.borrows
                                    .mul(marketData.underlyingPrice)
                                    .div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

        let marketSuppliedEth = accountMarket.tokens
                                    .mul(marketData.getExchangeRate())
                                    .div(constants.TEN.pow(18))
                                    .mul(marketData.underlyingPrice)
                                    .div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

        totalBorrowedEth = totalBorrowedEth.add(marketBorrowedEth);
        totalSuppliedEth = totalSuppliedEth.add(marketSuppliedEth);
    }

    return totalSuppliedEth / totalBorrowedEth; // Number arithmetic
};

const doLiquidation = (accounts, markets) => {
    let accountsSorted = Object.values(accounts).sort((a, b) => {
        getLiquidationRatio(a, markets) < getLiquidationRatio(b, markets) ? -1 : 1;
    });

    let ethToken = tokens.TokenFactory.getEthToken();

    let count = 10;
    for (let i = 0; i < count; i++) {
        let account = accountsSorted[i];

        let liquidationRatio = getLiquidationRatio(account, markets);

        console.log(`LIQUIDATION CANDIDATE ${account.address} RATIO ${liquidationRatio}}`);

        let totalBorrowedEth = constants.ZERO;
        let totalSuppliedEth = constants.ZERO;

        for (let [marketAddress, accountMarket] of Object.entries(account)) {
            if (marketAddress === 'address') {
                continue; // TODO fix hack
            }

            let marketData = markets[marketAddress]._data;

            let suppliedUnderlying = accountMarket.tokens
                .mul(marketData.getExchangeRate())
                .div(constants.TEN.pow(18));

            let borrowedUnderlying = accountMarket.borrows;

            let marketSuppliedEth = suppliedUnderlying
                                    .mul(marketData.underlyingPrice)
                                    .div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            let marketBorrowedEth = borrowedUnderlying
                                    .mul(marketData.underlyingPrice)
                                    .div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            console.log(`++ ${marketData.underlyingToken.formatAmount(borrowedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketBorrowedEth)} ETH borrowed`);
            console.log(`++ ${marketData.underlyingToken.formatAmount(suppliedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketSuppliedEth)} ETH supplied`);

            totalBorrowedEth = totalBorrowedEth.add(marketBorrowedEth);
            totalSuppliedEth = totalSuppliedEth.add(marketSuppliedEth);
        }

        console.log(`++ TOTAL ${ethToken.formatAmount(totalBorrowedEth)} ETH borrowed ${ethToken.formatAmount(totalSuppliedEth)} ETH supplied`);
    }
}

const listen = (accounts, markets, v1Oracle) => {
    v1Oracle.on('PricePosted', (asset, previousPrice, requestedPrice, newPrice) => {
        let token = tokens.TokenFactory.getTokenByAddress(asset);

        if (token === undefined) {
            console.log(`PRICE POSTED FOR UNKNOWN UNDERLYING ${asset} ${newPrice.toString()}`);
            return;
        }

        for (let market of Object.values(markets)) {
            if (market._data.underlyingToken !== token) {
                continue;
            }

            market._data.underlyingPrice = newPrice.div(constants.TEN.pow(18 - cTokenContract._data.underlyingToken.decimals));

            break;
        }

        console.log(`[${token.symbol}] PRICE_POSTED
            ${previousPrice.toString()} previousPrice
            ${requestedPrice.toString()} requestedPrice
            ${newPrice.toString()} newPrice`);
    });

    for (let [address, contract] of Object.entries(markets)) {
        let cTokenContract = contract;

        cTokenContract.on('AccrueInterest', (interestAccumulated, borrowIndexNew, totalBorrowsNew) => {
            cTokenContract._data.borrowIndex = borrowIndexNew;
            cTokenContract._data.totalBorrows = totalBorrowsNew;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] ACCRUE_INTEREST
                ${cTokenContract._data.token.formatAmount(borrowIndexNew)} borrowIndex
                ${cTokenContract._data.underlyingToken.formatAmount(totalBorrowsNew)} ${cTokenContract._data.underlyingToken.symbol} totalBorrowsNew
                ${cTokenContract._data.underlyingToken.formatAmount(interestAccumulated)} ${cTokenContract._data.underlyingToken.symbol} interestAccumulated`);
        });

        cTokenContract.on('Mint', (minter, mintAmount, mintTokens) => {
            // User supplied mintAmount to the pool and receives mintTokens cTokens in exchange
            // Followed by Transfer event

            cTokenContract._data.totalCash = cTokenContract._data.totalCash.add(mintAmount);
            cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.add(mintTokens);

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] MINT - ${minter} 
                ${cTokenContract._data.underlyingToken.formatAmount(mintAmount)} ${cTokenContract._data.underlyingToken.symbol} deposited
                ${cTokenContract._data.token.formatAmount(mintTokens)} ${cTokenContract._data.token.symbol} minted
                ${cTokenContract._data.token.formatAmount(cTokenContract._data.totalSupply)} totalSupply`);

            let minterData = minter in accounts ? accounts[minter][cTokenContract.address] : undefined;

            if (minterData !== undefined) {
                minterData.tokens = minterData.tokens.add(mintTokens);
            }

            doLiquidation(accounts, markets);
        });

        cTokenContract.on('Redeem', (redeemer, redeemAmount, redeemTokens) => {
            // User redeemed redeemTokens cTokens for redeemAmount underlying
            // Preceded by Transfer event

            cTokenContract._data.totalCash = cTokenContract._data.totalCash.sub(redeemAmount);

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] REDEEM - ${redeemer} 
                ${cTokenContract._data.token.formatAmount(redeemAmount)} ${cTokenContract._data.token.symbol} redeemed
                ${cTokenContract._data.underlyingToken.formatAmount(redeemTokens)} ${cTokenContract._data.underlyingToken.symbol} returned`);

            // Do this after both Transfer and Redeem run
            doLiquidation(accounts, markets);
        });

        cTokenContract.on('Borrow', (borrower, borrowAmount, accountBorrows, totalBorrows) => {
            // User borrowed borrowAmount tokens, new borrow balance is accountBorrows

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] BORROW ${borrower} 
                ${cTokenContract._data.underlyingToken.formatAmount(borrowAmount)} borrowed
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} outstanding`);

            cTokenContract._data.totalBorrows = totalBorrows;
            cTokenContract._data.totalCash = cTokenContract._data.totalCash.sub(borrowAmount);

            let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

            if (borrowerData !== undefined) {
                borrowerData.borrows = accountBorrows;
                borrowerData.borrowIndex = cTokenContract._data.borrowIndex;
            }

            doLiquidation(accounts, markets);
        });

        cTokenContract.on('RepayBorrow', (payer, borrower, repayAmount, accountBorrows, totalBorrows) => {
            // User repaid the borrow with repayAmount

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] REPAY_BORROW - ${borrower}
                ${cTokenContract._data.underlyingToken.formatAmount(repayAmount)} repaid
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} outstanding`);

            cTokenContract._data.totalBorrows = totalBorrows;
            cTokenContract._data.totalCash = cTokenContract._data.totalCash.add(repayAmount);

            let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

            if (borrowerData !== undefined) {
                borrowerData.borrows = accountBorrows;;
            }

            doLiquidation(accounts, markets);
        });

        cTokenContract.on('LiquidateBorrow', (liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens) => {
            // Another account liquidated the borrowing account by repaying repayAmount and seizing seizeTokens of cTokenCollateral
            // There is an associated Transfer event

            let collateralContract = allMarkets[cTokenCollateral];

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] LIQUIDATE_BORROW - ${liquidator} ${borrower}
                ${cTokenContract._data.underlyingToken.formatAmount(repayAmount)} ${cTokenContract._data.underlyingToken.symbol} repaid
                ${cTokenContract._data.underlyingToken.formatAmount(accountBorrows)} ${cTokenContract._data.underlyingToken.symbol} outstanding
                ${collateralContract._data.token.formatAmount(seizeTokens.toString())} ${collateralContract._data.token.symbol} collateral seized`);

            let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

            if (borrowerData !== undefined) {
                borrowerData.borrows = borrowerData.borrows.sub(repayAmount);
            }

            doLiquidation(accounts, markets);
        });

        cTokenContract.on('Transfer', (src, dst, amount) => {
            // Token balances were adjusted by amount, if src or dst is the contract itself update totalSupply
            let srcTracker = src in accounts ? accounts[src][cTokenContract.address] : undefined;
            let dstTracker = dst in accounts ? accounts[dst][cTokenContract.address] : undefined;

            let srcBalance, dstBalance;

            let isRedeem = true; // Only want to liquidate on redeem

            if (src == cTokenContract.address) {
                srcBalance = cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.sub(amount);
            } else {
                redeem = false;
                if (srcTracker !== undefined) {
                    srcBalance = srcTracker.tokens = srcTracker.tokens.sub(amount);
                }
            }

             if (dst == cTokenContract.address) {
                dstBalance = cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.add(amount);
            } else {
                if (dstTracker !== undefined) {
                    dstBalance = dstTracker.tokens = dstTracker.tokens.add(amount);
                }
            }

            let underlying = cTokenContract._data.underlyingToken;

            let fmtAddr = (addr) => addr == cTokenContract.address ? 'SUPPLY' : addr;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] TRANSFER ${fmtAddr(src)} => ${fmtAddr(dst)}
                ${cTokenContract._data.token.formatAmount(amount)} ${cTokenContract._data.token.symbol} transferred
                ${fmtAddr(src)} ${cTokenContract._data.token.formatAmount(srcBalance)} ${cTokenContract._data.token.symbol}
                ${fmtAddr(dst)} ${cTokenContract._data.token.formatAmount(dstBalance)} ${cTokenContract._data.token.symbol}`);

            if (isRedeem) {
                doLiquidation(accounts, markets);
            }
        });

        // This doesnt exist?

        // cTokenContract.on('ReservesAdded', (admin, amountAdded, totalReservesNew) => {
        //     console.log(`[${cTokenContract._data.underlyingToken.symbol}] RESERVES_ADDED
        //         +${cTokenContract._data.underlyingToken.formatAmount(amountAdded)} ${cTokenContract._data.underlyingToken.symbol}
        //         ${cTokenContract._data.underlyingToken.formatAmount(totalReservesNew)} ${cTokenContract._data.underlyingToken.symbol}`);

        //     cTokenContract._data.totalReserves = totalReservesNew;
        //     cTokenContract._data.totalCash = cTokenContract._data.totalCash.add(amountAdded);
        //     
        //     doLiquidation(accounts, markets);
        // });

        cTokenContract.on('ReservesReduced', (admin, amountReduced, totalReservesNew) => {
            console.log(`[${cTokenContract._data.underlyingToken.symbol}] RESERVES_REDUCED
                +${cTokenContract._data.underlyingToken.formatAmount(amountAdded)} ${cTokenContract._data.underlyingToken.symbol}
                ${cTokenContract._data.underlyingToken.formatAmount(totalReservesNew)} ${cTokenContract._data.underlyingToken.symbol}`);

            cTokenContract._data.totalReserves = totalReservesNew;
            cTokenContract._data.totalCash = cTokenContract._data.totalCash.sub(amountReduced);

            doLiquidation(accounts, markets);
        });
    }
}

const getMarkets = async (comptrollerContract) => {
    let markets = await comptrollerContract.getAllMarkets();

    let priceOracleContract = new ethers.Contract(PRICE_ORACLE_ADDRESS, PRICE_ORACLE_ABI, wallet);

    await priceOracleContract.deployed();

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

        let totalSupply = await cTokenContract.totalSupply();
        let totalBorrows = await cTokenContract.totalBorrows();
        let borrowIndex = await cTokenContract.borrowIndex();
        let totalReserves = await cTokenContract.totalReserves();
        let totalCash = await cTokenContract.getCash();

        let underlyingPrice = await priceOracleContract.getUnderlyingPrice(marketAddress);

        underlyingPrice = underlyingPrice.div(constants.TEN.pow(18 - underlyingToken.decimals));

        cTokenContract._data = new (function() {
            this.token = token;
            this.underlyingToken = underlyingToken;

            this.totalBorrows = totalBorrows;
            this.totalSupply = totalSupply;
            this.totalReserves = totalReserves;
            this.totalCash = totalCash;

            this.borrowIndex = borrowIndex;
            this.underlyingPrice = underlyingPrice;

            this.getExchangeRate = () => {
                return this.totalCash.add(this.totalBorrows)
                    .sub(this.totalReserves)
                    .mul(constants.TEN.pow(18))
                    .div(this.totalSupply);
            }
        })();

        let exchangeRate = await cTokenContract.exchangeRateStored();

        console.log(`cTOKEN ${underlyingToken.symbol} 
            exchangeRate ${cTokenContract._data.getExchangeRate().toString()} CONFIRMED AGAINST (${exchangeRate.toString()})
            totalSupply ${token.formatAmount(totalSupply)} ${token.symbol}
            totalBorrow ${underlyingToken.formatAmount(totalBorrows)} ${underlyingToken.symbol}
            totalCash ${underlyingToken.formatAmount(totalCash)} ${underlyingToken.symbol}
            borrowIndex ${borrowIndex.toString()}
            underlyingPrice ${tokens.TokenFactory.getEthToken().formatAmount(underlyingPrice)} ETH`);

        assert(cTokenContract._data.getExchangeRate().eq(exchangeRate));

        allMarkets[cTokenContract.address] = cTokenContract;
    }

    return allMarkets;
}

const getAccounts = async (markets, blockNumber) => {
    let allAccounts = [];

    let url = `https://api.compound.finance/api/v2/account`;

    let reqData = {
        min_borrow_value_in_eth: { value: '0.1' },
        block_number: blockNumber,
        page_size: 2500
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

    // Main accounts object
    // Account address => market address => tracker
    let accountsMap = {};

    // Load into data structure
    for (let account of allAccounts) {
        let accountAddress = ethers.utils.getAddress(account.address); // checksum case

        accountsMap[accountAddress] = {};

        for (let acctToken of account.tokens) {
            let market = markets[ethers.utils.getAddress(acctToken.address)]; // checksum case

            let exchangeRate = market._data.getExchangeRate();

            let cToken = market._data.token;
            let underlying = market._data.underlyingToken;

            let tracker = {
                tokens: underlying.parseAmount(acctToken.supply_balance_underlying.value)
                    .div(exchangeRate.div(constants.TEN.pow(underlying.decimals))),
                borrows: underlying.parseAmount(acctToken.borrow_balance_underlying.value),
                borrowIndex: constants.ZERO, // TODO calculate this from interest
            };

            accountsMap[accountAddress][market.address] = tracker;
            accountsMap[accountAddress].address = accountAddress;
        }
    }

    return accountsMap;
}

const getBlockNumber = () => {
    return new Promise((resolve, reject) => {
        ethers.provider.once('block', (blockNumber) => {
            resolve(blockNumber);
        });
    });
}

const getComptroller = async () => {
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, wallet);

    await comptrollerContract.deployed();

    return comptrollerContract;
}

const getV1Oracle = async () => {
    let oracleContract = new ethers.Contract(V1_ORACLE_ADDRESS, V1_ORACLE_ABI, wallet);

    await oracleContract.deployed();

    return oracleContract;
}

const run = async () => {
    await tokens.TokenFactory.init();

    console.log('READY LITTYQUIDATOR 1');

    let comptrollerContract = await getComptroller();

    let markets = await getMarkets(comptrollerContract);

    let blockNumber = await getBlockNumber();

    console.log(`STARTING FROM BLOCK NUMBER ${blockNumber}`);

    // Fetch accounts from REST service
    let accounts = await getAccounts(markets, blockNumber);

    console.log('ACCCOUNTS', Object.keys(accounts).length);

    doLiquidation(accounts, markets);

    let v1Oracle = await getV1Oracle();

    // Don't interrupt the event loop until block num is reset
    listen(accounts, markets, v1Oracle);

    // Start playing events from snapshot
    ethers.provider.resetEventsBlock(blockNumber);
}

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();