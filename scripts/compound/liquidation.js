const process = require('process'); // eslint
const crypto = require('crypto');

require('console-stamp')(console);

const axios = require('axios');
const assert = require('assert');
const fs = require('fs');

const bre = require('@nomiclabs/buidler');
const {ethers, deployments} = bre;

const tokens = require('./../tokens.js');
const constants = require('./../constants.js');

const COMPTROLLER_ADDRESS = ethers.utils.getAddress('0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b');
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));

const CTOKEN_V1_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken_v1.json'));
const CTOKEN_V2_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken_v2.json'));

const UNISWAP_ANCHORED_VIEW_ADDRESS = ethers.utils.getAddress('0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE');
const UNISWAP_ANCHORED_VIEW_ABI = JSON.parse(fs.readFileSync('abi/compound/uniswapanchoredview.json'));

const UNISWAP_FACTORY_ADDRESS = ethers.utils.getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'); 

// tokens
const WETH_ADDRESS = ethers.utils.getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const DAI_ADDRESS = ethers.utils.getAddress('0x6B175474E89094C44Da98b954EedeAC495271d0F');

// v2 ctokens
const CDAI_ADDRESS = ethers.utils.getAddress('0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643');
const CUSDT_ADDRESS = ethers.utils.getAddress('0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9');

// v1 ctokens
const CETH_ADDRESS = ethers.utils.getAddress('0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5');
const CSAI_ADDRESS = ethers.utils.getAddress('0xF5DCe57282A584D2746FaF1593d3121Fcac444dC');

const EXPONENT = constants.TEN.pow(18); // Compound math expScale

const LIQUIDATE_GAS_ESTIMATE = ethers.BigNumber.from(2000000); // from ganache test
const LIQUIDATE_LITE_GAS_ESTIMATE = ethers.BigNumber.from(800000); // TODO gastoken savings

const slackURL = 'https://hooks.slack.com/services/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';

const ETHERSCAN_API_KEY = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';
const COINBASE_API_KEY = '9437bb42b52baeec3407dbe344e80f84';

const COINBASE_SECRET = process.env.COINBASE_SECRET;
assert(COINBASE_SECRET !== null && COINBASE_SECRET !== undefined);

const BORROW_ETH_THRESHOLD = ethers.utils.parseEther('0.2');

let CLOSE_FACTOR_MANTISSA = undefined;
let LIQUIDATION_INCENTIVE_MANTISSA = undefined;

let comptrollerContractGlobal = undefined;
let uniswapAnchoredViewContractGlobal = undefined;
let liquidatorContractGlobal = undefined;
let liquidatorWrapperContractGlobal = undefined;
let liquidatorLiteContractGlobal = undefined;
let uniswapFactoryContractGlobal = undefined;
let operatingAccountGlobal = undefined;
let operatingAccountBalanceGlobal = undefined;

const liquidatorLiteTokenBalancesGlobal = {};

let providerGlobal = undefined;

let marketsGlobal = {};
let coinbasePricesGlobal = {};
let accountsGlobal = {};
let candidateAccountsGlobal = {};
let uniswapPairsGlobal = {};

let gasPriceGlobal = undefined;
let requiresAccountBalanceUpdateGlobal = false;

let isLiveGlobal = false;

let isDoneGlobal = false;

let shutdownRequestedGlobal = false;

// Start code

const doShutdown = () => {
    shutdownRequestedGlobal = true;
};

const sendMessage = async (subject, message) => {
    console.log(`SENDING MESSAGE: ${message}`);

    if (!process.env.PUBLISH_MESSAGES) {
        return; // dont send a message in dev
    }

    let data = {
        username: 'LiquidatorBot',
        text: message,
        icon_emoji: ':bangbang',
    };

    await axios.post(slackURL, JSON.stringify(data));
};

const updateLiquidatorLiteTokenBalances = async () => {
    try {
        for (let market of Object.values(marketsGlobal)) {
            let token = market._data.underlyingToken;

            let balance = token === tokens.TokenFactory.getEthToken()
                ? await providerGlobal.getBalance(liquidatorLiteContractGlobal.address) // eth
                : await token.contract.connect(providerGlobal).balanceOf(liquidatorLiteContractGlobal.address); // erc20

            liquidatorLiteTokenBalancesGlobal[token.address] = balance;

            console.log(`LIQUIDATOR LITE BALANCE ${token.formatAmount(balance)} ${token.symbol}`);
        }
    } catch (err) {
        console.log(constants.CONSOLE_RED, `ERROR FETCHING LIQUIDATOR LITE BALANCES - ${err}`);
        console.log(err);
    } finally {
        setTimeout(updateLiquidatorLiteTokenBalances, 60 * 1000);
    }
};

const checkUniswapLiquidity = (borrowedMarket, collateralMarket, repayBorrowAmount, seizeAmount) => {
    let ethToken = tokens.TokenFactory.getEthToken();

    // Check uniswap pair liquidity
    const uniswapBorrowTokenAddress = borrowedMarket.underlyingToken.address === ethToken.address ? WETH_ADDRESS : borrowedMarket.underlyingToken.address;
    const uniswapCollateralTokenAddress = collateralMarket.underlyingToken.address === ethToken.address ? WETH_ADDRESS : collateralMarket.underlyingToken.address;

    const uniswapPair = getUniswapPair(uniswapBorrowTokenAddress, uniswapCollateralTokenAddress);

    if (uniswapPair === undefined) {
        console.log(constants.CONSOLE_RED, 'NO UNISWAP PAIR');
        return false;
    }

    const token0 = uniswapPair.token0;
    const [reserve0, reserve1, ts] = uniswapPair.reserves;
    const reserveOut = uniswapBorrowTokenAddress === token0 ? reserve0 : reserve1;
    const reserveIn = uniswapBorrowTokenAddress === token0 ? reserve1 : reserve0;

    if (repayBorrowAmount.gte(reserveOut)) {
        console.log('UNISWAP PAIR INSUFFICIENT RESERVES');
        return false;
    }

    let amountIn;
    if (uniswapBorrowTokenAddress === uniswapCollateralTokenAddress) {
        amountIn = repayBorrowAmount.mul(1000).div(997).add(1);
    } else {
        const numerator = reserveIn.mul(repayBorrowAmount).mul(1000);
        const denominator = reserveOut.sub(repayBorrowAmount).mul(997);
        amountIn = numerator.div(denominator).add(1);
    }

    if (amountIn.gte(seizeAmount)) {
        console.log('UNISWAP PAYBACK EXCEEDS SEIZE AMOUNT');
        return false;
    }

    return true;
};

const liquidateAccount = (account, borrowedMarket, collateralMarket, repayBorrowAmount, coinbaseEntries, useLiteContract) => {
    if (isDoneGlobal) {
        console.log('Liquidation already sent');
        return;
    } else {
        isDoneGlobal = true;
    }

    let task;

    if (useLiteContract) {
        let liquidateMethod = isLiveGlobal ?
            liquidatorLiteContractGlobal.liquidate
            : liquidatorLiteContractGlobal.callStatic.liquidate;

        task = liquidateMethod(
            account,
            borrowedMarket.address,
            collateralMarket.address,
            repayBorrowAmount,
            0, // TODO calc chi gastoken amount,
            {
                gasPrice: gasPriceGlobal,
                gasLimit: LIQUIDATE_LITE_GAS_ESTIMATE, // TODO this needs to be without gas savings
            }
        );
    } else {
        let liquidateMethod = isLiveGlobal ? 
            liquidatorWrapperContractGlobal.liquidate 
            : liquidatorWrapperContractGlobal.callStatic.liquidate; // callStatic = dry run

        task = liquidateMethod(
            account,
            borrowedMarket.address,
            collateralMarket.address,
            repayBorrowAmount,
            coinbaseEntries.map(({message}) => message),
            coinbaseEntries.map(({signature}) => signature),
            coinbaseEntries.map(({symbol}) => symbol),
            {
                gasPrice: gasPriceGlobal,
                gasLimit: LIQUIDATE_GAS_ESTIMATE,
            }
        );
    }


    task.then(async (result) => {
        console.log(`LIQUIDATED ACCOUNT ${account} - RESULT ${JSON.stringify(result)}`);

        await sendMessage('LIQUIDATION', `LIQUIDATED ACCOUNT ${account} - ${JSON.stringify(result)}`);
    }).catch(async (err) => {
        console.log(`FAILED TO LIQUIDATE ACCOUNT ${account} - ERROR ${err}`);
        console.log(err);

        await sendMessage('LIQUIDATION', `FAILED TO LIQUIDATE ACCOUNT ${account} ${err}`);
    }).finally(() => {
        // Shut down the app after attempt
        doShutdown();
    });
};

const getUniswapPair = (borrowMarketUnderlyingAddress, collateralMarketUnderlyingAddress) => {
    if (borrowMarketUnderlyingAddress === collateralMarketUnderlyingAddress) {
        if (borrowMarketUnderlyingAddress === WETH_ADDRESS) {
            collateralMarketUnderlyingAddress = DAI_ADDRESS; // not supported anyway
        } else {
            collateralMarketUnderlyingAddress = WETH_ADDRESS;
        }
    }

    try {
        return uniswapPairsGlobal[borrowMarketUnderlyingAddress][collateralMarketUnderlyingAddress];
    } catch (err) {
        return undefined;
    }
};

const logLiquidationCandidate = (account, accountShortfall, accountMarketData, coinbaseEntries) => {
    let ethToken = tokens.TokenFactory.getEthToken();

    console.log(`LIQUIDATION CANDIDATE ${account.address}`);

    for (let data of accountMarketData) {
        let marketData = data.marketData;

        console.log(`++ ${marketData.underlyingToken.formatAmount(data.borrowedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(data.borrowedEth)} USD borrowed`);

        let exchRateFmt = marketData.getExchangeRate() / 10**(18 + (marketData.underlyingToken.decimals - marketData.token.decimals));
        console.log(`++    ${marketData.token.formatAmount(data.accountMarket.tokens)} ${marketData.token.symbol} @${exchRateFmt} => ${marketData.underlyingToken.formatAmount(data.suppliedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(data.suppliedEth)} USD supplied @(${ethToken.formatAmount(marketData.collateralFactor)})`);
    }

    console.log('++');

    if (coinbaseEntries.length > 0) {
        let coinbaseSymbols = coinbaseEntries.map(({symbol}) => symbol);
        console.log(`++ UPDATES PRICES ${JSON.stringify(coinbaseSymbols)}`);
    }

    let totalBorrowedEth = accountMarketData.reduce((acc, cur) => acc.add(cur.borrowedEth), constants.ZERO);
    let totalSuppliedEth = accountMarketData.reduce((acc, cur) => acc.add(cur.suppliedEth), constants.ZERO);

    console.log(`++ TOTAL ${ethToken.formatAmount(totalBorrowedEth)} USD borrowed / ${ethToken.formatAmount(totalSuppliedEth)} USD supplied`);

    console.log(`++ SHORTFALL ${ethToken.formatAmount(accountShortfall)}`);
};

const calculateAccountShortfall = (account) => {
    let ethToken = tokens.TokenFactory.getEthToken();

    let errRet = [constants.ZERO, null, null, null];

    let accountMarketData = [];

    let accountShortfall = constants.ZERO;
    for (let accountMarket of Object.values(account.markets)) {
        if (!accountMarket.entered) {
            continue;
        }

        let marketData = accountMarket.marketData;

        // Calculate the borrowed/supplied for this market/account
        let suppliedUnderlying = accountMarket.tokens
            .mul(marketData.getExchangeRate()).div(EXPONENT);

        let borrowedUnderlying = accountMarket.borrows;

        let marketSuppliedEth = suppliedUnderlying
            .mul(marketData.collateralFactor).div(EXPONENT)
            .mul(marketData.underlyingPrice).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

        let marketBorrowedEth = borrowedUnderlying
            .mul(marketData.underlyingPrice).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

        // Calculate for updated coinbase price
        let marketSuppliedEthUpdatedPrice = marketSuppliedEth;
        let marketBorrowedEthUpdatedPrice = marketBorrowedEth;

        let coinbasePrice = coinbasePricesGlobal[marketData.underlyingToken.symbol]
            ? coinbasePricesGlobal[marketData.underlyingToken.symbol].normalizedPrice
            : null; // coinbase doesn't have USDC price :okay:

        if (coinbasePrice !== null) {
            marketSuppliedEthUpdatedPrice = suppliedUnderlying
                .mul(marketData.collateralFactor).div(EXPONENT)
                .mul(coinbasePrice).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            marketBorrowedEthUpdatedPrice = borrowedUnderlying
                .mul(coinbasePrice).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));
        }

        // Calculate shortfall
        let marketShortfallEth = marketBorrowedEth.sub(marketSuppliedEth);
        let marketShortfallEthUpdatedPrice = marketBorrowedEthUpdatedPrice.sub(marketSuppliedEthUpdatedPrice);

        let useCoinbasePrice = marketShortfallEthUpdatedPrice.gt(marketShortfallEth);
        let shortfall = useCoinbasePrice ? marketShortfallEthUpdatedPrice : marketShortfallEth;

        accountShortfall = accountShortfall.add(shortfall);

        // Add to account markets data
        accountMarketData.push({
            // ref data
            account: accountMarket,
            accountMarket,
            market: marketData,
            marketData,
            underlyingPrice: marketData.underlyingPrice,
            coinbasePrice,
            // balances
            borrowedUnderlying,
            suppliedUnderlying,
            marketBorrowedEth,
            marketBorrowedEthUpdatedPrice,
            marketSuppliedEth,
            marketSuppliedEthUpdatedPrice,
            // shortfall
            marketShortfallEth,
            marketShortfallEthUpdatedPrice,
            shortfall,
            useCoinbasePrice, 
            chosenPrice: useCoinbasePrice ? coinbasePrice : marketData.underlyingPrice,
            borrowedEth: useCoinbasePrice ? marketBorrowedEthUpdatedPrice : marketBorrowedEth,
            suppliedEth: useCoinbasePrice ? marketSuppliedEthUpdatedPrice : marketSuppliedEth,
        });
    }

    if (accountShortfall.lte(0)) {
        return errRet;
    }

    // Prune the unnecessary price updates in reverse order of their contribution to shortfall
    accountMarketData = accountMarketData.sort((a, b) => a.shortfall.sub(b.shortfall).gt(0) ? -1 : 1); // asc

    for (let data of accountMarketData) {
        if (!data.useCoinbasePrice) {
            continue;
        }

        // if we dont update the price for this asset, are we still in shortfall?
        let newShortfall = accountShortfall.sub(data.shortfall).add(data.marketShortfallEth);
        if (newShortfall.lte(0)) {
            break;
        }

        // actually, dont update the price for this asset
        data.useCoinbasePrice = false;
        data.shortfall = data.marketShortfallEth;
        data.chosenPrice = data.underlyingPrice;
        data.borrowedEth = data.marketBorrowedEth;
        data.suppliedEth = data.marketSuppliedEth;

        accountShortfall = newShortfall;
    }

    // Select the best markets to do liquidation across
    let borrowedMarkets = [...accountMarketData].sort((a, b) => { return a.borrowedEth.sub(b.borrowedEth).gt(0) ? -1 : 1; }); // desc
    let suppliedMarkets = [...accountMarketData].sort((a, b) => { return a.suppliedEth.sub(b.suppliedEth).gt(0) ? -1 : 1; });

    let maxBorrowedEthEntry = borrowedMarkets[0];
    let maxSuppliedEthEntry = suppliedMarkets[0];

    // Same token can only be liquidated for v2 erc20 (DAI, USDT)
    if (maxBorrowedEthEntry.market === maxSuppliedEthEntry.market) {
        if (!(maxBorrowedEthEntry.market.underlyingToken.symbol in ['DAI', 'USDT'])) {
            if (borrowedMarkets.length == 1 || suppliedMarkets.length == 1) {
                return errRet; // Only one entered market
            }

            // Choose the largest market by eth amount
            if (borrowedMarkets[1].borrowedEth.gt(suppliedMarkets[1].suppliedEth)) {
                maxBorrowedEthEntry = borrowedMarkets[1];
            } else {
                maxSuppliedEthEntry = suppliedMarkets[1];
            }
        }
    }

    // Collect the coinbase data for price updates
    let coinbaseEntries = [];
    for (let i = 0; i < accountMarketData.length; i++) {
        let data = accountMarketData[i];

        if (data.useCoinBasePrice) {
            let coinbaseEntry = coinbasePricesGlobal[data.market.underlyingToken.symbol];

            coinbaseEntries.push({
                message: coinbaseEntry.message,
                signature: coinbaseEntry.signature,
                symbol: coinbaseEntry.rawSymbol
            });
        }
    }

    // The account is subject to liquidation, log info
    logLiquidationCandidate(account, accountShortfall, accountMarketData, coinbaseEntries);

    return [accountShortfall, maxBorrowedEthEntry, maxSuppliedEthEntry, coinbaseEntries];
};

const calculateLiquidationRevenue = (maxBorrowedEthEntry, maxSuppliedEthEntry) => {
    let ethToken = tokens.TokenFactory.getEthToken();

    // Pb = price borrow, Ps = price supplied, R = repay amount, Bx = balance
    //
    // C = 1.05 * Pb / Ps
    // R <= Bs / C
    // R <= Bb / 2
    // 
    // R = min(Bs / C, Bb / 2)

    let maxBorrowedEthMarket = maxBorrowedEthEntry.account;
    let maxSuppliedEthMarket = maxSuppliedEthEntry.account;

    let borrowedMarketData = maxBorrowedEthEntry.market;
    let suppliedMarketData = maxSuppliedEthEntry.market;

    let priceSupplied = maxSuppliedEthEntry.chosenPrice;
    let priceBorrowed = maxBorrowedEthEntry.chosenPrice;

    // underlying balance
    let balanceSupplied = maxSuppliedEthMarket.tokens // no collateral factor for repay calc
        .mul(suppliedMarketData.getExchangeRate())
        .div(constants.TEN.pow(18)); // supplied underlying

    let repaySupply = balanceSupplied
        .mul(EXPONENT).div(LIQUIDATION_INCENTIVE_MANTISSA) // scale by incentive
        .mul(priceSupplied).div(constants.TEN.pow(18 - (ethToken.decimals - suppliedMarketData.underlyingToken.decimals))) // supplied to eth
        .mul(EXPONENT).div(priceBorrowed); // eth to borrowed

    let balanceBorrowed = maxBorrowedEthMarket.borrows;

    let repayBorrow = balanceBorrowed.mul(CLOSE_FACTOR_MANTISSA).div(EXPONENT);

    const repaySupplyWasLarger = repaySupply.gt(repayBorrow);
    let repayAmount = repaySupplyWasLarger ? repayBorrow : repaySupply; // borrowed underlying
    // Since we are not accouting for interest, use 90% of the repay amount to avoid over-seizing
    repayAmount = repayAmount.mul(90).div(100); // TODO revisit

    // Calculate the seize amount
    let repayAmountEth = repayAmount.mul(priceBorrowed).div(constants.TEN.pow(borrowedMarketData.underlyingToken.decimals));

    let seizeAmountEth = repayAmountEth.mul(LIQUIDATION_INCENTIVE_MANTISSA).div(EXPONENT);

    let seizeAmount = seizeAmountEth.mul(constants.TEN.pow(suppliedMarketData.underlyingToken.decimals)).div(priceSupplied);

    let consoleLine = `++ LIQUIDATE ${borrowedMarketData.underlyingToken.formatAmount(repayAmount)} ${borrowedMarketData.underlyingToken.symbol} `;
    console.log(consoleLine + `=> SEIZE ${suppliedMarketData.underlyingToken.formatAmount(seizeAmount)} ${suppliedMarketData.underlyingToken.symbol}`);

    // Profit before gas costs
    let revenue = seizeAmountEth.sub(repayAmountEth);
    console.log(`++ REVENUE  ${ethToken.formatAmount(revenue)} USD`);

    return [revenue, repayAmount, seizeAmount];
};

const doLiquidation = () => {
    let ethToken = tokens.TokenFactory.getEthToken();

    const liquidationGasCost = LIQUIDATE_GAS_ESTIMATE.mul(gasPriceGlobal);
    const liquidationLiteGasCost = LIQUIDATE_LITE_GAS_ESTIMATE.mul(gasPriceGlobal);

    const liquidationCandidates = [];

    for (let accountAddress of Object.keys(candidateAccountsGlobal)) {
        let account = accountsGlobal[accountAddress];

        if (account.liquidated) {
            continue; // Prevent double tap
        }

        let [shortfallEth, maxBorrowedEthEntry, maxSuppliedEthEntry, coinbaseEntries] = calculateAccountShortfall(account);

        if (shortfallEth.lte(constants.ZERO)) {
            continue;
        }

        let [revenue, repayAmount, seizeAmount] = calculateLiquidationRevenue(maxBorrowedEthEntry, maxSuppliedEthEntry);

        let borrowedMarketData = maxBorrowedEthEntry.market;
        let suppliedMarketData = maxSuppliedEthEntry.market;

        // Do we have a balance to repay, otherwise check uniswap for flash loan availability/liquidity
        let useLiteContract = false; // TODO set this back
        let liquidatorLiteBalance = liquidatorLiteTokenBalancesGlobal[borrowedMarketData.underlyingToken.address];
        liquidatorLiteBalance = liquidatorLiteBalance ? liquidatorLiteBalance : constants.ZERO;
        if (coinbaseEntries.length == 0 && liquidatorLiteBalance.gte(repayAmount)) {
            let balanceFmt = borrowedMarketData.underlyingToken.formatAmount(liquidatorLiteBalance);
            console.log(`++ USING LITE CONTRACT BALANCE ${balanceFmt} ${borrowedMarketData.underlyingToken.symbol}`);
        } else {
            useLiteContract = false;
            console.log('++ USING FLASH LOAN CONTRACT');
            if (!checkUniswapLiquidity(borrowedMarketData, suppliedMarketData, repayAmount, seizeAmount)) {
                continue;
            }
        }

        // Calculate gas costs
        let ethPrice = marketsGlobal[CETH_ADDRESS]._data.underlyingPrice; 
        let gasCost = useLiteContract ? liquidationLiteGasCost : liquidationGasCost;
        let liquidationGasCostUSD = gasCost.mul(ethPrice).div(EXPONENT);
        let gasLineColor = liquidationGasCost.gt(operatingAccountBalanceGlobal) ? constants.CONSOLE_RED : constants.CONSOLE_DEFAULT;
        console.log(gasLineColor, `++ GAS COST ${ethToken.formatAmount(liquidationGasCostUSD)} USD / ${ethers.utils.formatEther(gasCost)} ETH (${LIQUIDATE_GAS_ESTIMATE} @ ${ethers.utils.formatUnits(gasPriceGlobal, 'gwei')} gwei) (${ethers.utils.formatEther(operatingAccountBalanceGlobal)} avail.)`);

        // Calculate profit
        let profit = revenue.sub(liquidationGasCostUSD);
        let profitColor = profit.gt(0) ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
        console.log(profitColor, `++ PROFIT ${ethToken.formatAmount(profit)} USD`);

        if (profit.lte(0)) {
            continue;
        }

        liquidationCandidates.push({
            accountAddress: account.address,
            borrowedMarketData,
            suppliedMarketData,
            repayAmount,
            coinbaseEntries,
            profit,
            useLiteContract,
            gasCost
        });

        // End of account
        console.log('');
    }

    if (liquidationCandidates.length == 0) {
        console.log(constants.CONSOLE_RED, 'NO LIQUIDATION CANDIDATES');
        return;
    }

    liquidationCandidates.sort((a, b) => {
        // sort by profit descending
        return a.profit.sub(b.profit).lt(0) ? 1 : -1;
    });

    let topCandidate = liquidationCandidates[0];

    if (topCandidate.gasCost.gt(operatingAccountBalanceGlobal)) {
        console.log(constants.CONSOLE_RED, 'INSUFFICIENT GAS');
        return;
    }

    console.log(constants.CONSOLE_GREEN, `LIQUIDATING ACCOUNT ${topCandidate.accountAddress}`);

    liquidateAccount(
        topCandidate.accountAddress,
        topCandidate.borrowedMarketData,
        topCandidate.suppliedMarketData,
        topCandidate.repayAmount,
        topCandidate.coinbaseEntries,
        topCandidate.useLiteContract
    ); 
};

const normalizeRawPrice = rawPrice => rawPrice.mul(constants.TEN.pow(30)).div(constants.TEN.pow(18));

const onPriceUpdated = (symbol, price) => {
    if (symbol === 'BTC') {
        symbol = 'WBTC';
    }

    for (let market of Object.values(marketsGlobal)) {
        if (market._data.underlyingToken.symbol === symbol) {
            // need to transform the price we receive to mirror
            // https://github.com/compound-finance/open-oracle/blob/master/contracts/Uniswap/UniswapAnchoredView.sol#L135
            let newPrice = normalizeRawPrice(price);
            let oldPrice = market._data.underlyingPrice;

            let ethToken = tokens.TokenFactory.getEthToken();
            console.log(`[${symbol}] PRICE_UPDATED (raw ${price.toString()}) ${ethToken.formatAmount(oldPrice)} => ${ethToken.formatAmount(newPrice)}`);

            market._data.underlyingPrice = newPrice;

            return;
        }
    }

    console.log(`NO MARKET FOR UPDATED PRICE ${symbol} ${price}`);
};

const onMarketEntered = ({cToken, account}) => {
    let marketData = marketsGlobal[cToken]._data;

    console.log(`[${marketData.underlyingToken.symbol}] MARKET_ENTERED ${account}`);

    let accountTracker = getAccount(account);
    accountTracker.markets[cToken].entered = true;
};

const onMarketExited = ({cToken, account}) => {
    let marketData = marketsGlobal[cToken]._data;

    console.log(`[${marketData.underlyingToken.symbol}] MARKET_EXITED ${account}`);

    let accountTracker = getAccount(account);
    accountTracker.markets[cToken].entered = false;
};

const getMarkets = async (comptrollerContract, priceOracleContract, blockNumber) => {
    let accounts = accountsGlobal;

    let markets = await comptrollerContract.getAllMarkets();

    let allMarkets = marketsGlobal;

    for (let marketAddress of markets) {
        let marketAbi = (marketAddress == CUSDT_ADDRESS || marketAddress == CDAI_ADDRESS) ? CTOKEN_V2_ABI : CTOKEN_V1_ABI;
        let cTokenContract = new ethers.Contract(marketAddress, marketAbi, ethers.provider);

        await cTokenContract.deployed();

        let token = await tokens.TokenFactory.loadToken(cTokenContract.address);
        if (cTokenContract.address === CSAI_ADDRESS) {
            token.symbol = 'cSAI';
        }

        let underlyingToken;
        if (cTokenContract.address !== CETH_ADDRESS) {
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

        let exchangeRate = await cTokenContract.exchangeRateStored(overrides);

        let reserveFactor = await cTokenContract.reserveFactorMantissa();

        console.log(`cTOKEN ${underlyingToken.symbol} (v${marketAbi === CTOKEN_V1_ABI ? '1' : '2'}) 
            address ${cTokenContract.address}
            token ${token.symbol}
            underlyingToken ${underlyingToken.symbol}
            totalSupply ${token.formatAmount(totalSupply)} ${token.symbol}
            totalBorrow ${underlyingToken.formatAmount(totalBorrows)} ${underlyingToken.symbol}
            totalCash ${underlyingToken.formatAmount(totalCash)} ${underlyingToken.symbol}
            totalReserves ${underlyingToken.formatAmount(totalReserves)} ${underlyingToken.symbol}
            exchangeRate ${exchangeRate / (10**(18 + (underlyingToken.decimals - token.decimals)))} ${token.symbol}/${underlyingToken.symbol}
            borrowIndex ${ethers.utils.formatEther(borrowIndex)}
            underlyingPrice ${tokens.TokenFactory.getEthToken().formatAmount(underlyingPrice)} USD
            collateralFactor ${ethers.utils.formatEther(collateralFactor)}
            reserveFactor ${ethers.utils.formatEther(reserveFactor)}`);

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
            this.reserveFactor = reserveFactor;

            this.getExchangeRate = () => {
                return this.totalCash.add(this.totalBorrows)
                    .sub(this.totalReserves)
                    .mul(constants.TEN.pow(18))
                    .div(this.totalSupply);
            };

            this.onAccrueInterest = ({interestAccumulated, borrowIndex, totalBorrows}) => {
                // TODO do we need to use cashPrior for v2
                this.borrowIndex = borrowIndex;
                this.totalBorrows = totalBorrows;
                this.totalReserves = this.totalReserves.add(interestAccumulated.mul(this.reserveFactor).div(EXPONENT));

                console.log(`[${this.underlyingToken.symbol}] ACCRUE_INTEREST
                    ${this.token.formatAmount(borrowIndex)} borrowIndex
                    ${this.underlyingToken.formatAmount(totalBorrows)} ${this.underlyingToken.symbol} totalBorrows
                    ${this.underlyingToken.formatAmount(interestAccumulated)} ${this.underlyingToken.symbol} interestAccumulated`);
            };

            this.onMint = ({minter, mintAmount, mintTokens}) => {
                // User supplied mintAmount to the pool and receives mintTokens cTokens in exchange
                // Followed by Transfer event

                this.totalCash = this.totalCash.add(mintAmount);

                console.log(`[${this.underlyingToken.symbol}] MINT - ${minter} 
                    ${this.underlyingToken.formatAmount(mintAmount)} ${this.underlyingToken.symbol} deposited
                    ${this.token.formatAmount(mintTokens)} ${this.token.symbol} minted
                    ${this.token.formatAmount(this.totalSupply)} totalSupply`);

                // Account not required to be created/entered when minting
                let minterAccount = getAccount(minter);

                let minterData = minterAccount.markets[this.address];
                minterData.tokens = minterData.tokens.add(mintTokens);
            };

            this.onRedeem = ({redeemer, redeemAmount, redeemTokens}) => {
                // User redeemed redeemTokens cTokens for redeemAmount underlying
                // Preceded by Transfer event which handles balance updates

                this.totalCash = this.totalCash.sub(redeemAmount);

                console.log(`[${this.underlyingToken.symbol}] REDEEM - ${redeemer} 
                    ${this.token.formatAmount(redeemTokens)} ${this.token.symbol} redeemed
                    ${this.underlyingToken.formatAmount(redeemAmount)} ${this.underlyingToken.symbol} returned`);
            };

            this.onBorrow = ({borrower, borrowAmount, accountBorrows, totalBorrows}) => {
                // User borrowed borrowAmount tokens, new borrow balance is accountBorrows

                console.log(`[${this.underlyingToken.symbol}] BORROW ${borrower} 
                    ${this.underlyingToken.formatAmount(borrowAmount)} borrowed
                    ${this.underlyingToken.formatAmount(accountBorrows)} outstanding`);

                this.totalBorrows = totalBorrows;
                this.totalCash = this.totalCash.sub(borrowAmount);

                // borrower must have entered markets, so account must exist
                let borrowerAccount = getAccount(borrower);

                let borrowerData = borrowerAccount.markets[this.address];
                borrowerData.borrows = accountBorrows;
                borrowerData.borrowIndex = this.borrowIndex;

                let totalBorrowedEth = borrowerAccount.totalBorrowedEth();
                if (totalBorrowedEth.gte(BORROW_ETH_THRESHOLD)) {
                    candidateAccountsGlobal[borrower] = totalBorrowedEth;
                }
            };

            this.onRepayBorrow = ({payer, borrower, repayAmount, accountBorrows, totalBorrows}) => {
                // User repaid the borrow with repayAmount

                console.log(`[${this.underlyingToken.symbol}] REPAY_BORROW - ${borrower}
                    ${this.underlyingToken.formatAmount(repayAmount)} repaid
                    ${this.underlyingToken.formatAmount(accountBorrows)} outstanding`);

                this.totalBorrows = totalBorrows;
                this.totalCash = this.totalCash.add(repayAmount);

                // account must exist to repay borrow
                let borrowerAccount = getAccount(borrower);

                let borrowerData = borrowerAccount.markets[this.address];
                borrowerData.borrows = accountBorrows;

                let totalBorrowedEth = borrowerAccount.totalBorrowedEth();
                if (totalBorrowedEth.gte(BORROW_ETH_THRESHOLD)) {
                    candidateAccountsGlobal[borrower] = totalBorrowedEth;
                } else {
                    delete candidateAccountsGlobal[borrower];
                }
            };

            this.onLiquidateBorrow = ({liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens}, ev) => {
                // Another account liquidated the borrowing account by repaying repayAmount and seizing seizeTokens of cTokenCollateral
                // There is an associated Transfer event
                let operatorLiquidated = liquidator === operatingAccountGlobal.address;

                let collateralData = allMarkets[cTokenCollateral]._data;

                let repayAmountFmt = this.underlyingToken.formatAmount(repayAmount);
                let seizeTokensFmt = collateralData.token.formatAmount(seizeTokens.toString()); // TODO why toString?

                let oursFmt = operatorLiquidated ? 'BANG!' : '';
                console.log(`[${this.underlyingToken.symbol}] LIQUIDATE_BORROW - ${oursFmt} ${liquidator} ${borrower}
                    ${repayAmountFmt} ${this.underlyingToken.symbol} repaid
                    ${seizeTokensFmt} ${collateralData.token.symbol} collateral seized`);

                // account exists to be liquidated
                let borrowerAccount = getAccount(borrower);

                let borrowerData = borrowerAccount.markets[this.address];
                borrowerData.borrows = borrowerData.borrows.sub(repayAmount);

                let totalBorrowedEth = borrowerAccount.totalBorrowedEth();
                if (totalBorrowedEth.gte(BORROW_ETH_THRESHOLD)) {
                    candidateAccountsGlobal[borrower] = totalBorrowedEth;
                } else {
                    delete candidateAccountsGlobal[borrower];
                }

                let seizeAmount = seizeTokens.mul(collateralData.getExchangeRate()).div(EXPONENT);
                let seizeAmountFmt = collateralData.underlyingToken.formatAmount(seizeAmount);

                sendMessage('LIQUIDATE_OBSERVED', `liquidation 
                    ${oursFmt} liquidator ${liquidator} borrower ${borrower} 
                    ${repayAmountFmt} ${this.underlyingToken.symbol} => ${seizeAmountFmt} ${collateralData.underlyingToken.symbol}
                    tx http://etherscan.io/tx/${ev.transactionHash}`);
            };

            this.onTransfer = ({from, to, amount}) => {
                let src = from;
                let dst = to;

                // Token balances were adjusted by amount, if src or dst is the contract itself update totalSupply
                if (src == this.address) {
                    // Mint - add tokens to total supply
                    this.totalSupply = this.totalSupply.add(amount);
                } else {
                    let srcAccount = getAccount(src);
                    let srcData = srcAccount.markets[this.address];
                    srcData.tokens = srcData.tokens.sub(amount);
                }

                if (dst == this.address) {
                    // Redeem - remove tokens from total supply
                    this.totalSupply = this.totalSupply.sub(amount);
                } else {
                    let dstAccount = getAccount(dst);
                    let dstData = dstAccount.markets[this.address];
                    dstData.tokens = dstData.tokens.add(amount);
                }

                let fmtAddr = (addr) => addr == this.address ? 'MARKET' : addr;

                console.log(`[${this.underlyingToken.symbol}] TRANSFER ${fmtAddr(src)} => ${fmtAddr(dst)}
                    ${this.token.formatAmount(amount)} ${this.token.symbol} transferred`);
            };

            this.onReservesReduced = ({admin, amountReduced, newTotalReserves}) => {
                console.log(`[${this.underlyingToken.symbol}] RESERVES_REDUCED ${admin}
                         ${this.underlyingToken.formatAmount(this.totalReserves)} ${this.underlyingToken.symbol}
                    --   ${this.underlyingToken.formatAmount(amountReduced)}
                    -----------------------------
                         ${this.underlyingToken.formatAmount(newTotalReserves)}`);

                this.totalReserves = newTotalReserves;
                this.totalCash = this.totalCash.sub(amountReduced);
            };

            this.onReservesAdded = ({benefactor, addAmount, newTotalReserves}) => {
                console.log(`[${this.underlyingToken.symbol}] RESERVES_ADDED ${benefactor}
                         ${this.underlyingToken.formatAmount(this.totalReserves)} ${this.underlyingToken.symbol}
                    ++   ${this.underlyingToken.formatAmount(addAmount)}
                    -----------------------------
                         ${this.underlyingToken.formatAmount(newTotalReserves)}`);

                this.totalReserves = newTotalReserves;
                this.totalCash = this.totalCash.add(addAmount);
            };

            this.onFailure = () => {
                console.log(`[${this.underlyingToken.symbol}] FAILURE`);
            };

            this.onApproval = () => {
                console.log(`[${this.underlyingToken.symbol}] APPROVAL`);
            };

            // End constructor
        })();


        allMarkets[cTokenContract.address] = cTokenContract;
    }

    return allMarkets;
};

const fetchAccountsData = async (blockNumber) => {
    let allAccounts = [];

    let url = 'https://api.compound.finance/api/v2/account';

    let reqData = {
        min_borrow_value_in_eth: { value: '0.2' },
        block_number: blockNumber,
        page_size: 250
    };

    let response = await axios.post(url, JSON.stringify(reqData));

    console.log(`FETCHED URL ${url}`);

    for (let account of response.data.accounts) {
        allAccounts.push(account);
    }

    console.log(`EXPECTED ACCOUNTS ${response.data.pagination_summary.total_entries}`);

    for (var i = 1; i < response.data.pagination_summary.total_pages; i++) {
        let page_url = `${url}?page_number=${i + 1}`;

        let r = await axios.post(page_url, JSON.stringify(reqData));

        console.log(`FETCHED URL ${page_url}`);

        for (let account of r.data.accounts) {
            allAccounts.push(account);
        }
    }

    return allAccounts;
};

const getAccount = (accountAddress) => {
    if (accountAddress in accountsGlobal) {
        return accountsGlobal[accountAddress];
    }

    let ethToken = tokens.TokenFactory.getEthToken();

    let accountTracker = new (function() { 
        this.liquidated = false;
        this.address = accountAddress;

        // for each market, default zero initialize the tracker
        this.markets = Object.fromEntries(
            Object.values(marketsGlobal).map((market) => {
                return [market._data.address, {
                    marketData: market._data,
                    marketAddress: market._data.address,
                    tokens: constants.ZERO,
                    borrows: constants.ZERO,
                    borrowIndex: constants.ZERO,
                    entered: false
                }];
            })
        );

        this.totalBorrowedEth = () => {
            let totalBorrowedEth = constants.ZERO;

            for (let tracker of Object.values(this.markets)) {
                if (!tracker.entered) {
                    assert(tracker.borrows.eq(constants.ZERO));
                }

                if (tracker.borrows.eq(constants.ZERO)) {
                    continue;
                }

                let borrowBalance = tracker.borrows
                    .mul(tracker.marketData.borrowIndex).div(EXPONENT)
                    .mul(EXPONENT).div(tracker.borrowIndex);

                let marketBorrowedEth = borrowBalance.mul(tracker.marketData.underlyingPrice)
                    .div(constants.TEN.pow(18 - (ethToken.decimals - tracker.marketData.underlyingToken.decimals)));

                totalBorrowedEth = totalBorrowedEth.add(marketBorrowedEth);
            }

            return totalBorrowedEth;
        };

        this.totalCollateralEth = () => {
            let totalCollateralEth = constants.ZERO;
            
            for (let tracker of Object.values(this.markets)) {
                if (!tracker.entered) {
                    continue;
                }

                let suppliedUnderlying = tracker.tokens
                    .mul(tracker.marketData.getExchangeRate()).div(EXPONENT);

                let marketSuppliedEth = suppliedUnderlying
                    .mul(tracker.marketData.collateralFactor).div(EXPONENT)
                    .mul(tracker.marketData.underlyingPrice).div(constants.TEN.pow(18 - (ethToken.decimals - tracker.marketData.underlyingToken.decimals)));

                totalCollateralEth = totalCollateralEth.add(marketSuppliedEth);
            }

            return totalCollateralEth;
        };
    })();

    accountsGlobal[accountAddress] = accountTracker; 

    return accountTracker;
};

const populateAccountMarkets = (allAccounts, markets, blockNumber) => {
    let ethPrice = marketsGlobal[CETH_ADDRESS]._data.underlyingPrice;

    for (let account of allAccounts) {
        let accountAddress = ethers.utils.getAddress(account.address); // checksum case

        let accountTracker = getAccount(accountAddress);

        console.dir(account, {depth: null});

        // populate market entries from response
        for (let acctToken of account.tokens) {
            let marketAddress = ethers.utils.getAddress(acctToken.address);

            let marketData = markets[marketAddress]._data; // checksum case

            let exchangeRate = marketData.getExchangeRate();

            let underlying = marketData.underlyingToken;

            let marketTracker = accountTracker.markets[marketAddress];

            marketTracker.entered = true; // TODO confirm this
            marketTracker.tokens = underlying.parseAmount(acctToken.supply_balance_underlying.value).mul(EXPONENT).div(exchangeRate);
            marketTracker.borrows = underlying.parseAmount(acctToken.borrow_balance_underlying.value);
            marketTracker.borrowIndex = constants.ZERO;

            if (marketTracker.borrows.gt(constants.ZERO)) {
                // borrow_bal = principal * borrowIndex / acctIndex
                // acctIndex = principal * borrowIndex / borrow_bal
                let interestAccrued = underlying.parseAmount(acctToken.lifetime_borrow_interest_accrued.value);
                let borrowBalance = marketTracker.borrows.add(interestAccrued);

                marketTracker.borrowIndex = marketTracker.borrows
                    .mul(marketData.borrowIndex).div(EXPONENT)
                    .mul(EXPONENT).div(borrowBalance);
            }
        }

        // if the account has enough borrowed, track it
        let totalBorrowedEth = accountTracker.totalBorrowedEth();
        if (totalBorrowedEth.gte(BORROW_ETH_THRESHOLD)) {
            //console.log(`CANDIDATE ACCOUNT ${accountAddress} BORROWS ${ethers.utils.formatEther(totalBorrowedEth)} ETH`);

            candidateAccountsGlobal[accountAddress] = totalBorrowedEth; // TODO do we need to store this value?
        }

        let totalCollateralEth = accountTracker.totalCollateralEth();

        // Compound api gives more precision than eth supports...
        let totalBorrowedEthRef = ethers.utils.parseEther(parseFloat(account.total_borrow_value_in_eth.value).toFixed(18));
        let totalCollateralEthRef = ethers.utils.parseEther(parseFloat(account.total_collateral_value_in_eth.value).toFixed(18));

        let totalBorrowedUSDRef = totalBorrowedEthRef.mul(ethPrice).div(EXPONENT);
        let totalCollateralUSDRef = totalCollateralEthRef.mul(ethPrice).div(EXPONENT);

        console.log(`ACCOUNT borrows ${ethers.utils.formatEther(totalBorrowedEth)} vs ${ethers.utils.formatEther(totalBorrowedUSDRef)} ref`);
        console.log(`ACCOUNT collateral ${ethers.utils.formatEther(totalCollateralEth)} vs ${ethers.utils.formatEther(totalCollateralUSDRef)} ref`);

        assert(totalBorrowedEthRef.eq(totalBorrowedEth));
        assert(totalCollateralEthRef.eq(totalCollateralEth));
    }

    return accountsGlobal;
};

const getComptroller = async () => {
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, ethers.provider);

    await comptrollerContract.deployed();

    CLOSE_FACTOR_MANTISSA = await comptrollerContract.closeFactorMantissa();

    console.log(`COMPTROLLER CLOSE FACTOR MANTISSA ${CLOSE_FACTOR_MANTISSA.toString()}`);

    LIQUIDATION_INCENTIVE_MANTISSA = await comptrollerContract.liquidationIncentiveMantissa();

    console.log(`COMPTROLLER LIQUIDATION INCENTIVE MANTISSA ${LIQUIDATION_INCENTIVE_MANTISSA.toString()}`);

    comptrollerContractGlobal = comptrollerContract;

    return comptrollerContract;
};

const getUniswapOracle = async () => {
    let uniswapAnchoredViewContract = new ethers.Contract(UNISWAP_ANCHORED_VIEW_ADDRESS, UNISWAP_ANCHORED_VIEW_ABI, ethers.provider);

    await uniswapAnchoredViewContract.deployed();

    uniswapAnchoredViewContractGlobal = uniswapAnchoredViewContract;

    return uniswapAnchoredViewContract;
};

const getLiquidator = async (operatingAccount) => {
    const liqDeployment = await deployments.get('CompoundLiquidator');

    // Connect this contract to the operating signer, this is the only contract to which we send signed transactions
    liquidatorContractGlobal = await ethers.getContractAt('CompoundLiquidator', liqDeployment.address, operatingAccount);

    let operatingAddress = await operatingAccount.getAddress();
    assert(await liquidatorContractGlobal.owner() == operatingAddress);

    console.log(`LIQUIDATOR DEPLOYED @ ${liquidatorContractGlobal.address}`);

    return liquidatorContractGlobal;
};

const getLiquidatorWrapper = async (operatingAccount) => {
    const liqWrapperDeployment = await deployments.get('CompoundLiquidatorWrapper');

    // Connect this contract to the operating signer, this is the only contract to which we send signed transactions
    liquidatorWrapperContractGlobal = await ethers.getContractAt('CompoundLiquidatorWrapper', liqWrapperDeployment.address, operatingAccount);

    let operatingAddress = await operatingAccount.getAddress();
    assert(await liquidatorWrapperContractGlobal.owner() == operatingAddress);

    console.log(`LIQUIDATOR WRAPPER DEPLOYED @ ${liquidatorWrapperContractGlobal.address}`);

    return liquidatorWrapperContractGlobal;
};

const getDeployedContract = async (contractName, address, signer) => {
    const deployment = await deployments.get(contractName);

    const contract = await ethers.getContractAt(contractName, address, signer);

    console.log(`CONTRACT ${contractName} DEPLOYED @ ${contract.address}`);

    return contract;
};

const getLiquidatorLite = async (operatingAccount) => {
    let liquidatorLiteContract = await getDeployedContract('CompoundLiquidatorLite', operatingAccount);

    let operatingAddress = await operatingAccount.getAddress();
    assert(await liquidatorWrapperContractGlobal.owner() == operatingAddress);

    liquidatorLiteContractGlobal = liquidatorLiteContract;

    return liquidatorLiteContract;
};

const getUniswapFactory = async () => {
    uniswapFactoryContractGlobal = await ethers.getContractAt('IUniswapV2Factory', UNISWAP_FACTORY_ADDRESS);

    return uniswapFactoryContractGlobal;
};

const updateGasPrice = async () => {
    try {
        let result = await axios.get(`https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`);

        // {"LastBlock":"10772578","SafeGasPrice":"235","ProposeGasPrice":"258","FastGasPrice":"270"}
        console.log(`GAS RESULT (etherscan) ${JSON.stringify(result.data)}`);

        gasPriceGlobal = ethers.utils.parseUnits(result.data.result.FastGasPrice, 'gwei');
    } catch (err) {
        // Try getting the gas price from the provider directly (costs requests)
        try {
            gasPriceGlobal = await providerGlobal.getGasPrice();

            console.log(`GAS RESULT (provider) ${ethers.utils.formatUnits(gasPriceGlobal, 'gwei')}`);
        } catch (err) {
            console.log('FAILED TO UPDATE GAS PRICE');
        }
    }

    // If the account has insufficient balance, notify
    let gasCost = LIQUIDATE_GAS_ESTIMATE.mul(gasPriceGlobal);
    if (gasCost.gt(operatingAccountBalanceGlobal) && !requiresAccountBalanceUpdateGlobal) {
        requiresAccountBalanceUpdateGlobal = true;

        let operatorBalanceFmt = ethers.utils.formatEther(operatingAccountBalanceGlobal); 
        let gasCostFmt = ethers.utils.formatEther(gasCost);
        let gasPriceFmt = ethers.utils.formatUnits(gasPriceGlobal, 'gwei');

        sendMessage('GAS_REQUIRED', 
            `Operator balance insuffucient for gas! bal. ${operatorBalanceFmt} < ${gasCostFmt} ETH (@ ${gasPriceFmt} gwei)`);
    }

    setTimeout(updateGasPrice, 30 * 1000);
};

const getOperatingAccount = async () => {
    // Load the operating address, 0th in buidler configuration
    let signers = await ethers.getSigners();
    let operatingAccount = signers[0];
    operatingAccountGlobal = operatingAccount;

    let operatingAddress = await operatingAccount.getAddress();
    operatingAccountGlobal.address = operatingAddress;

    await updateAccountBalance(operatingAddress);

    return operatingAccount;
};

const updateUniswapPairs = async () => {
    try {
        for (let pairs of Object.values(uniswapPairsGlobal)) {
            for (let pair of Object.values(pairs)) {
                pair.reserves = await pair.contract.connect(providerGlobal).getReserves();
            }
        }
    } catch (err) {
        console.log(`ERROR UPDATING UNISWAP RESERVES - ${err}`);
        console.log(err);
    }

    setTimeout(updateUniswapPairs, 30 * 1000);
};

const loadUniswapPairs = async (tokens) => {
    for (let i = 0; i < tokens.length; i++) {
        let t1 = tokens[i];
        let t1Address = t1.symbol === 'ETH' ? WETH_ADDRESS : t1.address;

        for (let j = i + 1; j < tokens.length; j++) {
            let t2 = tokens[j];
            let t2Address = t2.symbol === 'ETH' ? WETH_ADDRESS : t2.address;

            let pairAddress = await uniswapFactoryContractGlobal.getPair(t1Address, t2Address);

            if (pairAddress === constants.ZERO_ADDRESS) {
                console.log(`NO UNISWAP PAIR FOR ${t1.symbol} ${t2.symbol}`);
                continue;
            }

            let contract = await ethers.getContractAt('IUniswapV2Pair', pairAddress);

            if (!(t1Address in uniswapPairsGlobal)) {
                uniswapPairsGlobal[t1Address] = {};
            }

            if (!(t2Address in uniswapPairsGlobal)) {
                uniswapPairsGlobal[t2Address] = {};
            }

            let pairObject = {
                contract,
                token0: await contract.token0(),
                reserves: await contract.getReserves()
            };

            uniswapPairsGlobal[t1Address][t2Address] = pairObject;
            uniswapPairsGlobal[t2Address][t1Address] = pairObject;

            console.log(`UNISWAP PAIR ${t1.symbol} ${t2.symbol} ${pairObject.reserves}`);
        }
    }

    setTimeout(updateUniswapPairs, 30 * 1000);
};

const updateAccountBalance = async () => {
    let operatingAddress = operatingAccountGlobal.address;

    try {
        let operatorBalance = await providerGlobal.getBalance(operatingAddress);

        let balanceFmt = ethers.utils.formatEther(operatorBalance);

        if (operatingAccountBalanceGlobal !== undefined && !operatorBalance.eq(operatingAccountBalanceGlobal)) {
            requiresAccountBalanceUpdateGlobal = false;

            let prevBalanceFmt = ethers.utils.formatEther(operatingAccountBalanceGlobal);

            sendMessage('BALANCE_UPDATED', `Operating account balance updated ${prevBalanceFmt} => ${balanceFmt} ETH`);
        }

        operatingAccountBalanceGlobal = operatorBalance;

        console.log(`OPERATING ACCOUNT ${operatingAddress} BALANCE ${balanceFmt}`);

        return operatorBalance;
    } catch (err) {
        console.log('FAILED TO UPDATE ACCOUNT BALANCE');
        console.log(err);
    } finally {
        setTimeout(updateAccountBalance, 30 * 1000);
    }
};

const updateExternalPrices = async () => {
    let messages = [];
    let signatures = [];

    try {
        try {
            // First try coinbase
            let timestamp = String(Math.floor(+new Date() / 1000)); // UNIX epoch time
            let message = timestamp + 'GET' + '/oracle'; 
            let signature = crypto.createHmac('sha256', COINBASE_SECRET).update(message).digest('hex');
            let response = await axios.get('https://api.pro.coinbase.com/oracle', {
                headers: {
                    'CB-ACCESS-SIGN': signature,
                    'CB-ACCESS-TIMESTAMP': timestamp,
                    'CB-ACCESS-KEY': COINBASE_API_KEY
                }
            });

            messages = response.data.messages;
            signatures = response.data.signatures;
        } catch (err) {
            console.log(constants.CONSOLE_RED, `FAILED TO FETCH COINBASE DIRECT PRICES, FALLING BACK TO COMPOUND API ${err}`);

            // then try compound
            let response = await axios.get('https://prices.compound.finance');
            let {coinbase} = response.data;

            messages = coinbase.messages;
            signatures = coinbase.signatures;
        }
    } catch (err) {
        console.log(constants.CONSOLE_RED, `FAILED TO FETCH EXTERNAL PRICES ${err}`);
    }

    let anyPricesUpdated = false;
    if (messages.length > 0) {
        assert(messages.length === signatures.length);

        const messageAbi = ['string', 'uint64', 'string', 'uint64'];

        for (let i = 0; i < messages.length; i++) {
            let [kind, timestamp, symbol, price] = ethers.utils.defaultAbiCoder.decode(messageAbi, messages[i]);

            let normalizedSymbol = (symbol === 'BTC') ? 'WBTC' : symbol;
            let normalizedPrice = normalizeRawPrice(price);

            if (normalizedSymbol in coinbasePricesGlobal && coinbasePricesGlobal[normalizedSymbol].timestamp.gt(timestamp)) {
                // Do not take an older price
                continue;
            }

            if (!(normalizedSymbol in coinbasePricesGlobal) || !(coinbasePricesGlobal[normalizedSymbol].rawPrice.eq(price))) {
                // Log only when price is updated
                console.log(`UPDATING COINBASE PRICE ${normalizedSymbol} ${ethers.utils.formatEther(normalizedPrice)}`);
                anyPricesUpdated = true;
            }

            coinbasePricesGlobal[normalizedSymbol] = {
                message: messages[i],
                signature: signatures[i],
                rawSymbol: symbol,
                normalizedSymbol,
                rawPrice: price, // this is the raw price, same as what comes thru on onPriceUpdate
                normalizedPrice,
                timestamp,
            };
        }

    }

    if (anyPricesUpdated) {
        doLiquidation();
    } else {
        console.log('NO PRICE UPDATES');
    }
    
    setTimeout(updateExternalPrices, 3 * 1000);
};

const queryEvents = async (comptrollerContract, uniswapOracle, lastBlock, blockNumber) => {
    // collect provider tasks
    let tasks = [];

    for (let market of Object.values(marketsGlobal)) {
        let task = market.queryFilter('*', lastBlock + 1, blockNumber);
        tasks.push(task);
    }

    let oracleEventTask = uniswapOracle.queryFilter('*', lastBlock + 1, blockNumber);
    tasks.push(oracleEventTask);

    let comptrollerEventTask = comptrollerContract.queryFilter('*', lastBlock + 1, blockNumber);
    tasks.push(comptrollerEventTask);

    // wait for all tasks to finish and sort in chain order
    let allEvents = await Promise.all(tasks);
    allEvents = allEvents.flat(1);
    allEvents = allEvents.sort((a, b) => {
        // sort by blocknumber then logindex
        if (a.blockNumber === b.blockNumber) {
            return a.logIndex - b.logIndex;
        }

        return a.blockNumber - b.blockNumber;
    });

    return allEvents;
};

const handleEvents = (allEvents) => {
    for (let ev of allEvents) {
        if (!('event' in ev)) {
            // possible issue with the events abi
            throw new Error(`unhandled event ${JSON.stringify(ev)}`);
        }

        console.log(`EVENT tx ${ev.transactionHash} block ${ev.blockNumber} logIdx ${ev.logIndex} address ${ev.address} topics ${ev.topics}`);

        if (ev.address === comptrollerContractGlobal.address) {
            if (ev['event'] === 'MarketEntered') {
                onMarketEntered(ev.args);
            } else if (ev['event'] === 'MarketExited') {
                onMarketExited(ev.args);
            }
        } else if (ev.address === uniswapAnchoredViewContractGlobal.address) {
            if (ev['event'] === 'PriceUpdated') {
                onPriceUpdated(ev.args.symbol, ev.args.price);                
            }
        } else {
            let eventHandler = marketsGlobal[ev.address]._data['on' + ev['event']];

            try {
                eventHandler(ev.args, ev);
            } catch (err) {
                console.log(ev);
                throw err;
            }
        }
    }
};

const doUpdate = async (lastBlock, provider) => {
    // fetch the latest block
    let blockNumber = await provider.getBlockNumber();

    if (blockNumber === lastBlock) {
        console.log('NO NEW BLOCKS');
        await new Promise(resolve => setTimeout(resolve, 3 * 1000));
        return [blockNumber, []];
    }

    console.log(`UPDATING FOR BLOCKS [${lastBlock + 1} - ${blockNumber}]`);

    let comptroller = comptrollerContractGlobal.connect(provider);
    let oracle = uniswapAnchoredViewContractGlobal.connect(provider);

    let events = await queryEvents(comptroller, oracle, lastBlock, blockNumber);

    if (events.length === 0) {
        console.log('NO EVENTS');
    }

    return [blockNumber, events];
};

const mainLoop = async (startBlock) => {
    let lastBlock = startBlock;
    //let infura_keys = ['24290ba0ddf440c6a12883c527bd874a'];
    let infura_keys = process.env.INFURA_PROJECT_KEY ? [process.env.INFURA_PROJECT_KEY] : bre.config.app.infura_keys;
    let infura_index = 0;
    let provider = new ethers.providers.InfuraProvider('mainnet', infura_keys[infura_index]);

    providerGlobal = provider;

    // Repeatedly setup a new provider when an update fails
    let isPollingExternalPrices = false;
    while (!shutdownRequestedGlobal) {
        let events;

        try {
            // only provider calls in here
            [lastBlock, events] = await doUpdate(lastBlock, provider); 
        } catch (err) {
            console.log(`ERROR WITH PROVIDER ${infura_keys[infura_index]}`);
            console.log(err);

            sendMessage('ERROR', `PROVIDER ERROR - ${err}`);

            infura_index = (infura_index + 1) % infura_keys.length;
            provider = new ethers.providers.InfuraProvider('mainnet', infura_keys[infura_index]);
            providerGlobal = provider;

            continue;
        }

        if (!isPollingExternalPrices) {
            updateExternalPrices();
            isPollingExternalPrices = true;
        }

        if (events.length > 0) {
            handleEvents(events);

            doLiquidation();
        }
    }
};

const run = async () => {
    await sendMessage('LIQUIDATOR', `STARTING - LIVE=${isLiveGlobal}`);

    providerGlobal = ethers.provider;

    let operatingAccount = await getOperatingAccount();

    let liquidator = await getLiquidator(operatingAccount);

    let liquidatorWrapper = await getLiquidatorWrapper(operatingAccount);

    //let liquidatorLite = await getLiquidatorLite(operatingAccount); // TODO add this back

    await tokens.TokenFactory.init();

    await updateGasPrice();

    let comptrollerContract = await getComptroller();

    let uniswapOracle = await getUniswapOracle();

    await getUniswapFactory();

    console.log('READY LITTYQUIDATOR 1');

    // Start from some blocks back
    let blockNumber = await ethers.provider.getBlockNumber();

    let startBlock = blockNumber - 15;

    console.log(`STARTING FROM BLOCK NUMBER ${startBlock}`);

    // Load account data from compound, more likely to fail so do this first
    let accountsData = null;
    while (accountsData === null) {
        try {
            accountsData = await fetchAccountsData(blockNumber);
        } catch (err) {
            console.log(constants.CONSOLE_RED, `FAILED TO LOAD ACCOUNTS - TRYING AGAIN IN 5s`);
            await new Promise((resolve) => setTimeout(resolve, 5 * 1000));
        }
    }

    // Load markets from start block
    let markets = await getMarkets(comptrollerContract, uniswapOracle, startBlock);

    // Setup accounts with markets
    populateAccountMarkets(accountsData, markets, startBlock);

    // After fetching accounts since rest service fails spuriously
    await loadUniswapPairs(Object.values(markets).map((market) => market._data.underlyingToken));

    //await updateLiquidatorLiteTokenBalances(); // TODO add this back

    console.log('INITIALIZED');

    sendMessage('INITIALIZED', 'liquidator initialized');

    await mainLoop(startBlock);

    console.log('EXITING');

    await sendMessage('EXIT', 'Liquidator exiting');
};

module.exports = async (isLive) => {
    console.log('COMPILING...');
    
    await bre.run('compile');

    console.log(`STARTING live=${isLive}`);

    isLiveGlobal = isLive;

    // Graceful termination
    process.on('SIGINT', () => doShutdown());
    process.on('SIGTERM', () => doShutdown());

    // Kill immediately on error
    process.on('unhandledRejection', async (err) => {
        console.error(`UNHANDLED REJECTION ${err}`);
        console.log(err);

        await sendMessage('ERROR', `process exited - ${err}`);

        process.exit();
    });

    try {
        await run();
    } catch (err) {
        console.error(`EXCEPTION ${err}`);
        console.log(err);

        await sendMessage('ERROR', `process exited - ${err}`);
        
        throw err;
    }
};
