const axios = require('axios');
const assert = require('assert');
const fs = require('fs');
const util = require('util');

const {ethers, deployments} = require("@nomiclabs/buidler");

const wallet = require('./../wallet.js');
const tokens = require('./../tokens.js');
const constants = require('./../constants.js');

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));

const CTOKEN_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken.json'));

const PRICE_ORACLE_ADDRESS = '0xDDc46a3B076aec7ab3Fc37420A8eDd2959764Ec4';
const PRICE_ORACLE_ABI = JSON.parse(fs.readFileSync('abi/compound/priceoracle.json'));

const UNISWAP_ANCHORED_VIEW_ADDRESS = '0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE';
const UNISWAP_ANCHORED_VIEW_ABI = JSON.parse(fs.readFileSync('abi/compound/uniswapanchoredview.json'));

const EXPONENT = constants.TEN.pow(18); // Compound math expScale

let CLOSE_FACTOR_MANTISSA = undefined;
let LIQUIDATION_INCENTIVE_MANTISSA = undefined;

let comptrollerContractGlobal = undefined;
let liquidatorContractGlobal = undefined;

const slackURL = 'https://hooks.slack.com/services/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';

const sendMessage = async (subject, message) => {
    let data = {
        username: 'LiquidatorBot',
	text: message,
        icon_emoji: ':bangbang',
    };

    await axios.post(slackURL, JSON.stringify(data));

    console.log(`SENT MESSAGE: ${message}`);
}

const liquidateAccount = async (account, borrowedMarket, collateralMarket, repayBorrowAmount, shortfallEth) => {
    let comptrollerContract = await getComptroller();
    let [err, liquidity, shortfall] = await comptrollerContract.getAccountLiquidity(account);

    let ethToken = tokens.TokenFactory.getEthToken();
    let color = shortfallEth.eq(shortfall) ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
    console.log(color, `ACCOUNT ${account.address} SHORTFALL EXPECTED ${ethToken.formatAmount(shortfallEth)} ACTUAL ${ethToken.formatAmount(shortfall)}`);

    let result = await liquidatorContractGlobal.callStatic.liquidate( // callStatic = dry run
        account,
        borrowedMarket,
        collateralMarket,
        repayBorrowAmount,
        {
            "gasPrice" : ethers.utils.parseUnits(constants.LIQUIDATION_GAS_PRICE, 'gwei'),
            "gasLimit": constants.LIQUIDATION_GAS_LIMIT.toNumber(),
        }
    );

    console.log(`LIQUIDATION RESULT ${result}`);

    // let gasEstimate = await liquidatorContractGlobal.estimateGas.liquidate( // callStatic = dry run
    //     account,
    //     borrowedMarket,
    //     collateralMarket,
    //     repayBorrowAmount,
    //     {
    //         gasLimit: 5 * 10**10
    //     }
    // );

    //console.log(`Gas estimate: ${gasEstimate}`);

    await sendMessage('LIQUIDATION', `LIQUIDATED ACCOUNT ${account}`);
}

const doLiquidation = (accounts, markets) => {
    let ethToken = tokens.TokenFactory.getEthToken();
    const liquidationGasCost = ethers.utils.parseEther((Math.ceil(ethToken.price) + ''))
        .mul(constants.LIQUIDATION_GAS_LIMIT)
        .mul(ethers.utils.parseUnits(constants.LIQUIDATION_GAS_PRICE, 'gwei'))
        .div(EXPONENT);
    console.log(` \nLiquidation Gas Cost: ${ethToken.formatAmount(liquidationGasCost)} USD \n`);

    for (let account of Object.values(accounts)) {
        if (account.liquidated) {
            continue; // Prevent double tap
        }

        let accountConsoleLine = ''; // dont print anything until the account is interesting

        accountConsoleLine += `LIQUIDATION CANDIDATE ${account.address}` + '\n';

        let totalBorrowedEth = constants.ZERO;
        let totalSuppliedEth = constants.ZERO;

        let maxBorrowedEth = constants.ZERO;
        let maxBorrowedEthMarket = undefined;
        let maxSuppliedEth = constants.ZERO;
        let maxSuppliedEthMarket = undefined;

        for (let [marketAddress, accountMarket] of Object.entries(account)) {
            if (marketAddress === 'address') {
                continue; // TODO fix hack
            }

            let marketData = markets[marketAddress]._data;

            let suppliedUnderlying = accountMarket.tokens
                .mul(marketData.getExchangeRate()).div(EXPONENT);

            let marketSuppliedEth = suppliedUnderlying
                                    .mul(marketData.collateralFactor).div(EXPONENT)
                                    .mul(marketData.underlyingPrice).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            let borrowedUnderlying = accountMarket.borrows;

            let marketBorrowedEth = borrowedUnderlying
                                    .mul(marketData.underlyingPrice)
                                    .div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            let consoleLine = `++ ${marketData.underlyingToken.formatAmount(borrowedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketBorrowedEth)} USD borrowed \t`;
            consoleLine += `${marketData.token.formatAmount(accountMarket.tokens)} ${marketData.token.symbol} => ${marketData.underlyingToken.formatAmount(suppliedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketSuppliedEth)} USD supplied @(${ethToken.formatAmount(marketData.collateralFactor)})`
            accountConsoleLine += consoleLine + '\n';

            totalBorrowedEth = totalBorrowedEth.add(marketBorrowedEth);
            totalSuppliedEth = totalSuppliedEth.add(marketSuppliedEth);

            if (marketBorrowedEth.gte(maxBorrowedEth)) {
                maxBorrowedEth = marketBorrowedEth;
                maxBorrowedEthMarket = accountMarket;
            }

            if (marketSuppliedEth.gte(maxSuppliedEth)) {
                maxSuppliedEth = marketSuppliedEth;
                maxSuppliedEthMarket = accountMarket;
            }
        }

        if (maxSuppliedEth.eq(0)) {
            continue;
        }

        let shortfallEth = totalBorrowedEth.sub(totalSuppliedEth);

        if (shortfallEth.lte(0)) {
            continue;
        }

        console.log(accountConsoleLine);

        console.log(`++ TOTAL ${ethToken.formatAmount(totalBorrowedEth)} USD borrowed / ${ethToken.formatAmount(totalSuppliedEth)} USD supplied`);
        console.log(`++ SHORTFALL ${ethToken.formatAmount(shortfallEth)}`);

        // Pb = price borrow, Ps = price supplied, R = repay amount, Bx = balance
        //
        // C = 1.05 * Pb / Ps
        // R <= Bs / C
        // R <= Bb / 2
        // 
        // R = min(Bs / C, Bb / 2)

        let suppliedMarketData = markets[maxSuppliedEthMarket.marketAddress]._data;
        let borrowedMarketData = markets[maxBorrowedEthMarket.marketAddress]._data;

        let priceSupplied = suppliedMarketData.underlyingPrice;
        let priceBorrowed = borrowedMarketData.underlyingPrice;
         
        let balanceSupplied = maxSuppliedEthMarket.tokens // no collateral factor for repay calc
            .mul(suppliedMarketData.getExchangeRate())
            .div(constants.TEN.pow(18 - suppliedMarketData.token.decimals)); // supplied underlying

        let repaySupply = balanceSupplied
            .mul(EXPONENT).div(LIQUIDATION_INCENTIVE_MANTISSA) // scale by incentive
            .mul(priceSupplied).div(constants.TEN.pow(suppliedMarketData.underlyingToken.decimals)) // supplied to eth
            .mul(EXPONENT).div(priceBorrowed); // eth to borrowed

        let balanceBorrowed = maxBorrowedEthMarket.borrows;

        let repayBorrow = balanceBorrowed.mul(CLOSE_FACTOR_MANTISSA).div(EXPONENT);

        let repayAmount = repaySupply.gt(repayBorrow) ? repayBorrow : repaySupply; // borrowed underlying

        let repayAmountEth = repayAmount.mul(priceBorrowed).div(constants.TEN.pow(borrowedMarketData.underlyingToken.decimals));

        let seizeAmountEth = repayAmountEth.mul(LIQUIDATION_INCENTIVE_MANTISSA).div(EXPONENT);

        let seizeAmount = seizeAmountEth.mul(constants.TEN.pow(suppliedMarketData.underlyingToken.decimals)).div(priceSupplied);

        let consoleLine = `++ LIQUIDATE ${borrowedMarketData.underlyingToken.formatAmount(repayAmount)} ${borrowedMarketData.underlyingToken.symbol} `
        console.log(consoleLine + `=> SEIZE ${suppliedMarketData.underlyingToken.formatAmount(seizeAmount)} ${suppliedMarketData.underlyingToken.symbol}`);

        let profit = seizeAmountEth.sub(repayAmountEth);
        console.log(`++ PROFIT ${ethToken.formatAmount(profit)} USD`);
        console.log('');

        if (profit.gt(liquidationGasCost)) {
            console.log(constants.CONSOLE_GREEN, `LIQUIDATING ACCOUNT ${account.address}`);
            liquidateAccount(account.address, borrowedMarketData.address, suppliedMarketData.address, repayAmount, shortfallEth).then(() => {
                // Nothing to do yet
            });
            account.liquidated = true;
        }
    }
}

const listenPricesUniswap = (markets, uniswapOracle) => {
    uniswapOracle.on('PriceUpdated', (symbol, price) => {
        for (let market of Object.values(markets)) {
            if (market._data.underlyingToken.symbol === symbol) {
                // need to transform the price we receive to mirror
                // https://github.com/compound-finance/open-oracle/blob/master/contracts/Uniswap/UniswapAnchoredView.sol#L135
                market._data.underlyingPrice = price.mul(constants.TEN.pow(30))
                    .div(market._data.underlyingToken.decimals);
                console.log(`[${symbol}] PRICE_UPDATED ${price.toString()}`);

                break;
            }
            throw new Error("Could not find market for symbol " + symbol);
        }
    });

    uniswapOracle.on('AnchorPriceUpdated', (symbol, anchorPrice, oldTimestamp, newTimestamp) => {
        // Nothing to do here, yet
    });
}

const listenMarkets = (accounts, markets) => {
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
        });

        cTokenContract.on('Redeem', (redeemer, redeemAmount, redeemTokens) => {
            // User redeemed redeemTokens cTokens for redeemAmount underlying
            // Preceded by Transfer event

            cTokenContract._data.totalCash = cTokenContract._data.totalCash.sub(redeemAmount);

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] REDEEM - ${redeemer} 
                ${cTokenContract._data.token.formatAmount(redeemTokens)} ${cTokenContract._data.token.symbol} redeemed
                ${cTokenContract._data.underlyingToken.formatAmount(redeemAmount)} ${cTokenContract._data.underlyingToken.symbol} returned`);
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
        });

        cTokenContract.on('LiquidateBorrow', (liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens) => {
            // Another account liquidated the borrowing account by repaying repayAmount and seizing seizeTokens of cTokenCollateral
            // There is an associated Transfer event

            let collateralContract = markets[cTokenCollateral];

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] LIQUIDATE_BORROW - ${liquidator} ${borrower}
                ${cTokenContract._data.underlyingToken.formatAmount(repayAmount)} ${cTokenContract._data.underlyingToken.symbol} repaid
                ${collateralContract._data.token.formatAmount(seizeTokens.toString())} ${collateralContract._data.token.symbol} collateral seized`);

            let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

            if (borrowerData !== undefined) {
                borrowerData.borrows = borrowerData.borrows.sub(repayAmount);
            }
        });

        cTokenContract.on('Transfer', (src, dst, amount) => {
            // Token balances were adjusted by amount, if src or dst is the contract itself update totalSupply
            let srcTracker = src in accounts ? accounts[src][cTokenContract.address] : undefined;
            let dstTracker = dst in accounts ? accounts[dst][cTokenContract.address] : undefined;

            let srcBalance = constants.ZERO;
            let dstBalance = constants.ZERO;

            if (src == cTokenContract.address) {
                // Mint - add tokens to total supply
                srcBalance = cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.add(amount);
            } else {
                if (srcTracker !== undefined) {
                    srcBalance = srcTracker.tokens = srcTracker.tokens.sub(amount);
                }
            }

             if (dst == cTokenContract.address) {
                // Redeem - remove tokens from total supply
                dstBalance = cTokenContract._data.totalSupply = cTokenContract._data.totalSupply.sub(amount);
            } else {
                if (dstTracker !== undefined) {
                    dstBalance = dstTracker.tokens = dstTracker.tokens.add(amount);
                }
            }

            let underlying = cTokenContract._data.underlyingToken;

            let fmtAddr = (addr) => addr == cTokenContract.address ? 'MARKET' : addr;

            console.log(`[${cTokenContract._data.underlyingToken.symbol}] TRANSFER ${fmtAddr(src)} => ${fmtAddr(dst)}
                ${cTokenContract._data.token.formatAmount(amount)} ${cTokenContract._data.token.symbol} transferred`);
        });

        // This doesnt exist?

        // cTokenContract.on('ReservesAdded', (admin, amountAdded, totalReservesNew) => {
        //     console.log(`[${cTokenContract._data.underlyingToken.symbol}] RESERVES_ADDED
        //         +${cTokenContract._data.underlyingToken.formatAmount(amountAdded)} ${cTokenContract._data.underlyingToken.symbol}
        //         ${cTokenContract._data.underlyingToken.formatAmount(totalReservesNew)} ${cTokenContract._data.underlyingToken.symbol}`);

        //     cTokenContract._data.totalReserves = totalReservesNew;
        //     cTokenContract._data.totalCash = cTokenContract._data.totalCash.add(amountAdded);
        //     
        //     //doLiquidation(accounts, markets);
        // });

        cTokenContract.on('ReservesReduced', (admin, amountReduced, totalReservesNew) => {
            console.log(`[${cTokenContract._data.underlyingToken.symbol}] RESERVES_REDUCED
                +${cTokenContract._data.underlyingToken.formatAmount(amountAdded)} ${cTokenContract._data.underlyingToken.symbol}
                ${cTokenContract._data.underlyingToken.formatAmount(totalReservesNew)} ${cTokenContract._data.underlyingToken.symbol}`);

            cTokenContract._data.totalReserves = totalReservesNew;
            cTokenContract._data.totalCash = cTokenContract._data.totalCash.sub(amountReduced);
        });
    }
}

const getMarkets = async (comptrollerContract, priceOracleContract, blockNumber) => {
    let markets = await comptrollerContract.getAllMarkets();

    let allMarkets = {};

    for (let marketAddress of markets) {
        let cTokenContract = new ethers.Contract(marketAddress, CTOKEN_ABI, wallet);

        await cTokenContract.deployed();

        let token = await tokens.TokenFactory.loadToken(cTokenContract.address);

        let underlyingToken;
        if (cTokenContract.address !== '0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5') {
            let underlying = await cTokenContract.underlying();
            underlyingToken = await tokens.TokenFactory.getTokenByAddress(underlying);
        } else {
            underlyingToken = tokens.TokenFactory.getEthToken();
        }

        let overrides = {
            blockTag: blockNumber
        };

        let [totalSupply, totalBorrows, borrowIndex, totalReserves, totalCash] = await Promise.all([
            cTokenContract.totalSupply(overrides),
            cTokenContract.totalBorrows(overrides),
            cTokenContract.borrowIndex(overrides),
            cTokenContract.totalReserves(overrides),
            cTokenContract.getCash(overrides),
        ]);

        let underlyingPrice = await priceOracleContract.getUnderlyingPrice(marketAddress, overrides);

        underlyingPrice = underlyingPrice.div(constants.TEN.pow(18 - underlyingToken.decimals));

        let [isListed, collateralFactor] = await comptrollerContract.markets(marketAddress, overrides);

        cTokenContract._data = new (function() {
            this.address = cTokenContract.address;
            this.contract = cTokenContract;

            this.token = token;
            this.underlyingToken = underlyingToken;

            this.totalBorrows = totalBorrows;
            this.totalSupply = totalSupply;
            this.totalReserves = totalReserves;
            this.totalCash = totalCash;

            this.borrowIndex = borrowIndex;
            this.underlyingPrice = underlyingPrice;

            this.collateralFactor = collateralFactor;

            this.getExchangeRate = () => {
                return this.totalCash.add(this.totalBorrows)
                    .sub(this.totalReserves)
                    .mul(constants.TEN.pow(18))
                    .div(this.totalSupply);
            }
        })();

        let exchangeRate = await cTokenContract.exchangeRateStored(overrides);

        console.log(`cTOKEN ${underlyingToken.symbol} 
            exchangeRate ${cTokenContract._data.getExchangeRate().toString()} CONFIRMED
            totalSupply ${token.formatAmount(totalSupply)} ${token.symbol}
            totalBorrow ${underlyingToken.formatAmount(totalBorrows)} ${underlyingToken.symbol}
            totalCash ${underlyingToken.formatAmount(totalCash)} ${underlyingToken.symbol}
            borrowIndex ${borrowIndex.toString()}
            underlyingPrice ${tokens.TokenFactory.getEthToken().formatAmount(underlyingPrice)} ETH
            collateralFactor ${collateralFactor.toString()}`);

        assert(cTokenContract._data.getExchangeRate().eq(exchangeRate));

        allMarkets[cTokenContract.address] = cTokenContract;
    }

    return allMarkets;
}

const getAccounts = async (markets, blockNumber) => {
    let allAccounts = [];

    let url = `https://api.compound.finance/api/v2/account`;

    let reqData = {
        min_borrow_value_in_eth: { value: '0.2' },
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
        accountsMap[accountAddress].address = accountAddress;

        for (let acctToken of account.tokens) {
            let marketAddress = ethers.utils.getAddress(acctToken.address);

            let market = markets[marketAddress]; // checksum case

            let exchangeRate = market._data.getExchangeRate();

            let cToken = market._data.token;
            let underlying = market._data.underlyingToken;

            let tracker = {
                marketAddress: marketAddress,
                tokens: underlying.parseAmount(acctToken.supply_balance_underlying.value)
                    .mul(EXPONENT).div(exchangeRate),
                borrows: underlying.parseAmount(acctToken.borrow_balance_underlying.value),
                borrowIndex: constants.ZERO, // TODO calculate this from interest
                liquidated: false, // set after liquidation occurs
            };

            accountsMap[accountAddress][marketAddress] = tracker;
        }
    }

    return accountsMap;
}

const getComptroller = async () => {
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, wallet);

    await comptrollerContract.deployed();

    CLOSE_FACTOR_MANTISSA = await comptrollerContract.closeFactorMantissa();

    console.log(`COMPTROLLER CLOSE FACTOR MANTISSA ${CLOSE_FACTOR_MANTISSA.toString()}`);

    LIQUIDATION_INCENTIVE_MANTISSA = await comptrollerContract.liquidationIncentiveMantissa();

    console.log(`COMPTROLLER LIQUIDATION INCENTIVE MANTISSA ${LIQUIDATION_INCENTIVE_MANTISSA.toString()}`);

    comptrollerContractGlobal = comptrollerContract;

    return comptrollerContract;
}

const getV1Oracle = async () => {
    let oracleContract = new ethers.Contract(V1_ORACLE_ADDRESS, V1_ORACLE_ABI, wallet);

    await oracleContract.deployed();

    return oracleContract;
}

const getUniswapOracle = async () => {
    let uniswapAnchoredViewContract = new ethers.Contract(UNISWAP_ANCHORED_VIEW_ADDRESS, UNISWAP_ANCHORED_VIEW_ABI, wallet);

    await uniswapAnchoredViewContract.deployed();

    return uniswapAnchoredViewContract;
}

const getLiquidator = async () => {
    const liqDeployment = await deployments.get("CompoundLiquidator");
    liquidatorContractGlobal = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);
    console.log(`LIQUIDATOR DEPLOYED @ ${liquidatorContractGlobal.address}`);
    return liquidatorContractGlobal;
}

const run = async () => {
    await sendMessage('LIQUIDATOR', 'starting...');

    process.on('unhandledRejection', async (err) => {
        console.log(err);

        await sendMessage('ERROR', `process exited\n ${err}`);

        process.exit();
    });

    let signers = await ethers.getSigners();
    let operatingAccount = signers[0];
    let operatingAddress = await operatingAccount.getAddress();
    let operatorBalance = await ethers.provider.getBalance(operatingAddress);

    console.log(`OPERATING ACCOUNT ${operatingAddress} BALANCE ${ethers.utils.formatEther(operatorBalance)}`); 

    let liquidator = await getLiquidator();
    assert(await liquidator.owner() == operatingAddress);

    await tokens.TokenFactory.init();

    console.log('READY LITTYQUIDATOR 1');

    let comptrollerContract = await getComptroller();

    let uniswapOracle = await getUniswapOracle();

    // Start from some blocks back
    let blockNumber = await ethers.provider.getBlockNumber();

    let startBlock = blockNumber - 15;

    console.log(`STARTING FROM BLOCK NUMBER ${startBlock}`);

    // Load markets from start block
    let markets = await getMarkets(comptrollerContract, uniswapOracle, startBlock);

    // Fetch accounts from REST service
    let accounts = await getAccounts(markets, startBlock);

    // Don't interrupt the event loop until block num is reset
    listenPricesUniswap(markets, uniswapOracle);
    listenMarkets(accounts, markets);

    // Start playing events from snapshot
    ethers.provider.resetEventsBlock(startBlock + 1);

    ethers.provider.on('didPoll', async () => {
        let newBlock = await ethers.provider.getBlockNumber();

        if (newBlock > blockNumber) {
            console.log(`NEW BLOCK ${newBlock}`);
            blockNumber = newBlock;

            doLiquidation(accounts, markets);
        }
    });

    // Long running
    while (true) {
        await new Promise( resolve => setTimeout( resolve, 5000 ) );
    }
}

module.exports = run
