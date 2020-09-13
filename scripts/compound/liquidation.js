require('console-stamp')(console);

const axios = require('axios');
const assert = require('assert');
const fs = require('fs');
const util = require('util');
const ObjectsToCsv = require('objects-to-csv');

const bre = require("@nomiclabs/buidler");
const {ethers, deployments} = bre;

const tokens = require('./../tokens.js');
const constants = require('./../constants.js');

const COMPTROLLER_ADDRESS = ethers.utils.getAddress('0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b');
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));

const CTOKEN_V1_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken_v1.json'));
const CTOKEN_V2_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken_v2.json'));

const PRICE_ORACLE_ADDRESS = ethers.utils.getAddress('0xDDc46a3B076aec7ab3Fc37420A8eDd2959764Ec4');
const PRICE_ORACLE_ABI = JSON.parse(fs.readFileSync('abi/compound/priceoracle.json'));

const UNISWAP_ANCHORED_VIEW_ADDRESS = ethers.utils.getAddress('0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE');
const UNISWAP_ANCHORED_VIEW_ABI = JSON.parse(fs.readFileSync('abi/compound/uniswapanchoredview.json'));

const UNISWAP_FACTORY_ADDRESS = ethers.utils.getAddress('0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f'); 

// tokens
const WETH_ADDRESS = ethers.utils.getAddress('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const USDT_ADDRESS = ethers.utils.getAddress('0xdac17f958d2ee523a2206206994597c13d831ec7');

// v2 ctokens
const CDAI_ADDRESS = ethers.utils.getAddress('0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643');
const CUSDT_ADDRESS = ethers.utils.getAddress('0xf650c3d88d12db855b8bf7d11be6c55a4e07dcc9');

// v1 ctokens
const CETH_ADDRESS = ethers.utils.getAddress('0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5');

const EXPONENT = constants.TEN.pow(18); // Compound math expScale

const LIQUIDATE_GAS_ESTIMATE = ethers.BigNumber.from(2000000); // from ganache test

const slackURL = 'https://hooks.slack.com/services/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';

const ETHERSCAN_API_KEY = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';

let CLOSE_FACTOR_MANTISSA = undefined;
let LIQUIDATION_INCENTIVE_MANTISSA = undefined;

let comptrollerContractGlobal = undefined;
let liquidatorContractGlobal = undefined;
let liquidatorWrapperContractGlobal = undefined;
let uniswapFactoryContractGlobal = undefined;
let operatingAccountGlobal = undefined;
let operatingAccountBalanceGlobal = undefined;

let marketsGlobal = {};
let coinbasePricesGlobal = {};
let accountsGlobal = {};

let gasPriceGlobal = undefined;

let isLiveGlobal = false;

let isDoneGlobal = false;

// Start code

const liquidationRecords = [];
const addLiquidationRecord = (
    account, borrowedMarket, collateralMarket, 
    repayBorrowAmount, seizeAmount, estimatedSeizeAmount, shortfallEth, 
    repaySupplyWasLarger, reserveIn, reserveOut, amountIn, err
) => {
	liquidationRecords.push({
		account,
		borrowedMarket,
		repayBorrowAmount: repayBorrowAmount.toString(),
		collateralMarket,
		borrowAndCollateralMarket: `${borrowedMarket}-${collateralMarket}`,
		seizeAmount: seizeAmount.toString(),
		estimatedSeizeAmount,
		shortfallEth,
		works: err === '' ? 'Y' : 'N',
		repaySupplyWasLarger: repaySupplyWasLarger ? 'Y' : 'N',
		amountOut: repayBorrowAmount.toString(),
		reserveOut: reserveOut.toString(),
		reserveIn: reserveIn.toString(),
		amountIn: amountIn.toString(),
		err
	});
}

const sendMessage = async (subject, message) => {
    console.log(`SENDING MESSAGE: ${message}`);

    if (!isLiveGlobal) {
        return; // dont send a message in dev
    }

    let data = {
        username: 'LiquidatorBot',
	text: message,
        icon_emoji: ':bangbang',
    };

    await axios.post(slackURL, JSON.stringify(data));
}

const liquidateAccount = async (account, borrowedMarket, collateralMarket, repayBorrowAmount, seizeAmount, shortfallEth, repaySupplyWasLarger, coinbaseEntries) => {
    let ethToken = tokens.TokenFactory.getEthToken();

    // Check uniswap pair liquidity
    const uniswapBorrowTokenAddress = borrowedMarket.underlyingToken.address === ethToken.address ? WETH_ADDRESS : borrowedMarket.underlyingToken.address;
    const uniswapCollateralTokenAddress = collateralMarket.underlyingToken.address === ethToken.address ? WETH_ADDRESS : collateralMarket.underlyingToken.address;
    const uniswapPair = await getUniswapPair(uniswapBorrowTokenAddress, uniswapCollateralTokenAddress);
    const [reserve0, reserve1, ts] = await uniswapPair.getReserves();
    const token0 = await uniswapPair.token0();

    const reserveOut = uniswapBorrowTokenAddress === token0 ? reserve0 : reserve1;
    const reserveIn = uniswapBorrowTokenAddress === token0 ? reserve1 : reserve0;

    if (repayBorrowAmount.gte(reserveOut)) {
	console.log(`Uniswap did not have enough reserves when liquidating account ${account}`);
	return;
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
	console.log(`Did not seize enough repay uniswap for account: ${account}`);
	return;
    }

    if (isDoneGlobal) {
        console.log('Liquidation already sent');
        return;
    } else {
        isDoneGlobal = true;
    }

    try {
	let liquidateMethod = isLiveGlobal ? 
	    liquidatorWrapperContractGlobal.liquidate 
	    : liquidatorWrapperContractGlobal.callStatic.liquidate; // callStatic = dry run

	let result = await liquidateMethod(
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

	console.log(`LIQUIDATED ACCOUNT ${account} - RESULT ${JSON.stringify(result)}`);

	await sendMessage('LIQUIDATION', `LIQUIDATED ACCOUNT ${account} - ${JSON.stringify(result)}`);
    } catch (err) {
        console.log(`FAILED TO LIQUIDATE ACCOUNT ${account} - ERROR ${err}`);

	await sendMessage('LIQUIDATION', `FAILED TO LIQUIDATE ACCOUNT ${account} ${err}`);
    } 

    console.log('EXITING');
    process.exit();
};

// TODO add caching
const uniswapPairs = {};

const getUniswapPair = async (borrowMarketUnderlyingAddress, collateralMarketUnderlyingAddress) => {
    if (borrowMarketUnderlyingAddress === collateralMarketUnderlyingAddress) {
        if (borrowMarketUnderlyingAddress === WETH_ADDRESS) {
            collateralMarketUnderlyingAddress = DAI_ADDRESS; // not supported anyway
        } else {
            collateralMarketUnderlyingAddress = WETH_ADDRESS;
        }
    }

    let pairAddress = await uniswapFactoryContractGlobal.getPair(
	    borrowMarketUnderlyingAddress,
	    collateralMarketUnderlyingAddress
    );

    return await ethers.getContractAt("IUniswapV2Pair", pairAddress);
};

const doLiquidation = () => {
    let accounts = accountsGlobal;
    let markets = marketsGlobal;

    let ethToken = tokens.TokenFactory.getEthToken();

    const liquidationGasCost = LIQUIDATE_GAS_ESTIMATE.mul(gasPriceGlobal);

    const liquidationCandidates = [];

    for (let account of Object.values(accounts)) {
        if (account.liquidated) {
            continue; // Prevent double tap
        }

        let accountConsoleLines = [`LIQUIDATION CANDIDATE ${account.address}`];

        let totalBorrowedEth = constants.ZERO;
        let totalSuppliedEth = constants.ZERO;

        let borrowedMarkets = [];
        let suppliedMarkets = [];

        for (let [marketAddress, accountMarket] of Object.entries(account)) {
            if (marketAddress === 'address' || marketAddress === 'liquidated') {
                continue; // TODO fix hack
            }

            let marketData = markets[marketAddress]._data;

            // coinbase doesn't have USDC price :okay:
	    let coinbasePrice = coinbasePricesGlobal[marketData.underlyingToken.symbol]
		    ? coinbasePricesGlobal[marketData.underlyingToken.symbol].normalizedPrice
		    : null;

            let suppliedUnderlying = accountMarket.tokens
                .mul(marketData.getExchangeRate()).div(EXPONENT);

	    let borrowedUnderlying = accountMarket.borrows;

	    let useCoinBasePrice = false;
            if (coinbasePrice !== null) {
		if (borrowedUnderlying.gt(suppliedUnderlying) && coinbasePrice.gt(marketData.underlyingPrice)) {
		    useCoinBasePrice = true;
		}

		if (suppliedUnderlying.gt(borrowedUnderlying) && marketData.underlyingPrice.gt(coinbasePrice)) {
		    useCoinBasePrice = true;
		}
            }

	    let priceForCalculation = useCoinBasePrice ? coinbasePrice : marketData.underlyingPrice;

            let marketSuppliedEth = suppliedUnderlying
		.mul(marketData.collateralFactor).div(EXPONENT)
		.mul(priceForCalculation).div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            let marketBorrowedEth = borrowedUnderlying
		.mul(priceForCalculation)
		.div(constants.TEN.pow(18 - (ethToken.decimals - marketData.underlyingToken.decimals)));

            let exchRateFmt = marketData.getExchangeRate() / 10**(18 + (marketData.underlyingToken.decimals - marketData.token.decimals));
            accountConsoleLines.push(`++ ${marketData.underlyingToken.formatAmount(borrowedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketBorrowedEth)} USD borrowed`);
            accountConsoleLines.push(`++    ${marketData.token.formatAmount(accountMarket.tokens)} ${marketData.token.symbol} @${exchRateFmt} => ${marketData.underlyingToken.formatAmount(suppliedUnderlying)} ${marketData.underlyingToken.symbol} / ${ethToken.formatAmount(marketSuppliedEth)} USD supplied @(${ethToken.formatAmount(marketData.collateralFactor)})`);

            totalBorrowedEth = totalBorrowedEth.add(marketBorrowedEth);
            totalSuppliedEth = totalSuppliedEth.add(marketSuppliedEth);

            // use this to keep track of shortfall for sort

            borrowedMarkets.push({
                account: accountMarket,
                ethAmount: marketBorrowedEth,
                market: marketData,
		useCoinBasePrice,
		chosenPrice: priceForCalculation,
            });

            suppliedMarkets.push({
                account: accountMarket,
                ethAmount: marketSuppliedEth,
                market: marketData,
		useCoinBasePrice,
		chosenPrice: priceForCalculation,
            });
        }

        let shortfallEth = totalBorrowedEth.sub(totalSuppliedEth);

        if (shortfallEth.lte(0)) {
            // Account not in shortfall
            continue;
        }

	// TODO next we can prune for where we dont need to post coinbase price

        // sort so largest is in front by ethAmount
        borrowedMarkets.sort((a, b) => { return a.ethAmount.sub(b.ethAmount).lt(0) ? 1 : -1; });
        suppliedMarkets.sort((a, b) => { return a.ethAmount.sub(b.ethAmount).lt(0) ? 1 : -1; });

        let maxBorrowedEthEntry = borrowedMarkets[0];
        let maxSuppliedEthEntry = suppliedMarkets[0];

        // Same token can only be liquidated for v2 erc20 (DAI, USDT)
        if (maxBorrowedEthEntry.market === maxSuppliedEthEntry.market) {
            if (!(maxBorrowedEthEntry.market.underlyingToken.symbol in ['DAI', 'USDT'])) {
                if (borrowedMarkets.length == 1 || suppliedMarkets.length == 1) {
                    continue; // Only one entered market
                }

                // Choose the largest market by eth amount
                if (borrowedMarkets[1].ethAmount.gt(suppliedMarkets[1].ethAmount)) {
                    maxBorrowedEthEntry = borrowedMarkets[1];
                } else {
                    maxSuppliedEthEntry = suppliedMarkets[1];
                }
            }
        }

        // The account is subject to liquidation, log
        for (let line of accountConsoleLines) {
            console.log(line);
        }

        console.log(`++`);
        console.log(`++ TOTAL ${ethToken.formatAmount(totalBorrowedEth)} USD borrowed / ${ethToken.formatAmount(totalSuppliedEth)} USD supplied`);
        console.log(`++ SHORTFALL ${ethToken.formatAmount(shortfallEth)}`);

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

        let coinbaseEntries = [];

        for (let i = 0; i < borrowedMarkets.length; i++) {
	    if (borrowedMarkets[i].useCoinBasePrice) {
		let coinbaseEntry = coinbasePricesGlobal[borrowedMarkets[i].market.underlyingToken.symbol];

		coinbaseEntries.push({
                    message: coinbaseEntry.message,
                    signature: coinbaseEntry.signature,
                    symbol: coinbaseEntry.rawSymbol
                });
	    }
	}

        let coinbaseSymbols = coinbaseEntries.map(({symbol}) => symbol);
        console.log(`Posting prices for: ${JSON.stringify(coinbaseSymbols)}`);

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
        repayAmount = repayAmount.mul(90).div(100);

        let repayAmountEth = repayAmount.mul(priceBorrowed).div(constants.TEN.pow(borrowedMarketData.underlyingToken.decimals));

        let seizeAmountEth = repayAmountEth.mul(LIQUIDATION_INCENTIVE_MANTISSA).div(EXPONENT);

        let seizeAmount = seizeAmountEth.mul(constants.TEN.pow(suppliedMarketData.underlyingToken.decimals)).div(priceSupplied);

        let consoleLine = `++ LIQUIDATE ${borrowedMarketData.underlyingToken.formatAmount(repayAmount)} ${borrowedMarketData.underlyingToken.symbol} `
        console.log(consoleLine + `=> SEIZE ${suppliedMarketData.underlyingToken.formatAmount(seizeAmount)} ${suppliedMarketData.underlyingToken.symbol}`);

        let revenue = seizeAmountEth.sub(repayAmountEth);
        console.log(`++ REVENUE  ${ethToken.formatAmount(revenue)} USD`);

        // Calculate gas costs
        let ethPrice = markets[CETH_ADDRESS]._data.underlyingPrice; // get the 
        let liquidationGasCostUSD = liquidationGasCost.mul(ethPrice).div(EXPONENT);
        console.log(`++ GAS COST ${ethToken.formatAmount(liquidationGasCostUSD)} USD / ${ethers.utils.formatEther(liquidationGasCost)} ETH (${LIQUIDATE_GAS_ESTIMATE} @ ${ethers.utils.formatUnits(gasPriceGlobal, 'gwei')} gwei) (${ethers.utils.formatEther(operatingAccountBalanceGlobal)} avail.)`);

        // Calculate profit
        let profit = revenue.sub(liquidationGasCostUSD);
        let profitColor = profit.gt(0) ? constants.CONSOLE_GREEN : constants.CONSOLE_RED;
        console.log(profitColor, `++ PROFIT ${ethToken.formatAmount(profit)} USD`);

        if (liquidationGasCost.gt(operatingAccountBalanceGlobal)) {
	    console.log('cant liquidate with gas greater than account balance');
	    continue;
        }

        if (profit.gt(0)) {
            liquidationCandidates.push({
		accountAddress: account.address,
		borrowedMarketData,
		suppliedMarketData,
		repayAmount,
		seizeAmount,
		shortfallEth,
		repaySupplyWasLarger,
                coinbaseEntries,
                profit
            });
        }

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

    console.log(constants.CONSOLE_GREEN, `LIQUIDATING ACCOUNT ${topCandidate.accountAddress}`);

    liquidateAccount(
	topCandidate.accountAddress,
	topCandidate.borrowedMarketData,
	topCandidate.suppliedMarketData,
	topCandidate.repayAmount,
	topCandidate.seizeAmount,
	topCandidate.shortfallEth,
	topCandidate.repaySupplyWasLarger,
        topCandidate.coinbaseEntries
    ).then(() => {
	// noop
    });

    // TODO mark account as liquidated to avoid double tap
    // account.liquidated = true;
}

const normalizeRawPrice = rawPrice => rawPrice.mul(constants.TEN.pow(30)).div(constants.TEN.pow(18));
const onPriceUpdated = (symbol, price, markets) => {
    if (symbol === 'BTC') {
    	symbol = 'WBTC';
    }

    for (let market of Object.values(markets)) {
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
}

const onMarketEntered = ({cToken, account}) => {
    let marketData = marketsGlobal[cToken]._data;

    console.log('[${marketData.underlyingToken.symbol}] MARKET_ENTERED ${account}');

    if (!(account in accountsGlobal)) {
        return;
    }

    accountsGlobal[account][cToken] = {
	marketAddress: cToken,
	tokens: constants.ZERO,
	borrows: constants.ZERO,
	borrowIndex: constants.ZERO,
    };
}

const onMarketExited = ({cToken, account}) => {
    let marketData = marketsGlobal[cToken]._data;

    console.log('[${marketData.underlyingToken.symbol}] MARKET_EXITED ${account}');

    if (account in accountsGlobal) {
        delete accountsGlobal[account][cToken];
    }
}

const getMarkets = async (comptrollerContract, priceOracleContract, blockNumber) => {
    let accounts = accountsGlobal;

    let markets = await comptrollerContract.getAllMarkets();

    let allMarkets = marketsGlobal;

    for (let marketAddress of markets) {
        let marketAbi = (marketAddress == CUSDT_ADDRESS || marketAddress == CDAI_ADDRESS) ? CTOKEN_V2_ABI : CTOKEN_V1_ABI;
        let cTokenContract = new ethers.Contract(marketAddress, marketAbi, ethers.provider);

        await cTokenContract.deployed();

        let token = await tokens.TokenFactory.loadToken(cTokenContract.address);

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
            }

            this.doAccrueInterest = ({interestAccumulated, borrowIndex, totalBorrows}) => {
                // TODO do we need to use cashPrior for v2
		this.borrowIndex = borrowIndex;
		this.totalBorrows = totalBorrows;
                this.totalReserves = this.totalReserves.add(interestAccumulated.mul(this.reserveFactor).div(EXPONENT));

		console.log(`[${this.underlyingToken.symbol}] ACCRUE_INTEREST
		    ${this.token.formatAmount(borrowIndex)} borrowIndex
		    ${this.underlyingToken.formatAmount(totalBorrows)} ${this.underlyingToken.symbol} totalBorrows
		    ${this.underlyingToken.formatAmount(interestAccumulated)} ${this.underlyingToken.symbol} interestAccumulated`);
	    };

	    this.doMint = ({minter, mintAmount, mintTokens}) => {
		// User supplied mintAmount to the pool and receives mintTokens cTokens in exchange
		// Followed by Transfer event

		this.totalCash = this.totalCash.add(mintAmount);

		console.log(`[${this.underlyingToken.symbol}] MINT - ${minter} 
		    ${this.underlyingToken.formatAmount(mintAmount)} ${this.underlyingToken.symbol} deposited
		    ${this.token.formatAmount(mintTokens)} ${this.token.symbol} minted
		    ${this.token.formatAmount(this.totalSupply)} totalSupply`);

		let minterData = minter in accounts ? accounts[minter][cTokenContract.address] : undefined;

		if (minterData !== undefined) {
		    minterData.tokens = minterData.tokens.add(mintTokens);
		}
	    };

	    this.doRedeem = ({redeemer, redeemAmount, redeemTokens}) => {
		// User redeemed redeemTokens cTokens for redeemAmount underlying
		// Preceded by Transfer event

		this.totalCash = this.totalCash.sub(redeemAmount);

		console.log(`[${this.underlyingToken.symbol}] REDEEM - ${redeemer} 
		    ${this.token.formatAmount(redeemTokens)} ${this.token.symbol} redeemed
		    ${this.underlyingToken.formatAmount(redeemAmount)} ${this.underlyingToken.symbol} returned`);
	    };

	    this.doBorrow = ({borrower, borrowAmount, accountBorrows, totalBorrows}) => {
		// User borrowed borrowAmount tokens, new borrow balance is accountBorrows

		console.log(`[${this.underlyingToken.symbol}] BORROW ${borrower} 
		    ${this.underlyingToken.formatAmount(borrowAmount)} borrowed
		    ${this.underlyingToken.formatAmount(accountBorrows)} outstanding`);

		this.totalBorrows = totalBorrows;
		this.totalCash = this.totalCash.sub(borrowAmount);

		let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

		if (borrowerData !== undefined) {
		    borrowerData.borrows = accountBorrows;
		    borrowerData.borrowIndex = this.borrowIndex;
		}
	    };

	    this.doRepayBorrow = ({payer, borrower, repayAmount, accountBorrows, totalBorrows}) => {
		// User repaid the borrow with repayAmount

		console.log(`[${this.underlyingToken.symbol}] REPAY_BORROW - ${borrower}
		    ${this.underlyingToken.formatAmount(repayAmount)} repaid
		    ${this.underlyingToken.formatAmount(accountBorrows)} outstanding`);

		this.totalBorrows = totalBorrows;
		this.totalCash = this.totalCash.add(repayAmount);

		let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

		if (borrowerData !== undefined) {
		    borrowerData.borrows = accountBorrows;;
		}
	    };

	    this.doLiquidateBorrow = ({liquidator, borrower, repayAmount, cTokenCollateral, seizeTokens}) => {
		// Another account liquidated the borrowing account by repaying repayAmount and seizing seizeTokens of cTokenCollateral
		// There is an associated Transfer event

		let collateralContract = allMarkets[cTokenCollateral];

		console.log(`[${this.underlyingToken.symbol}] LIQUIDATE_BORROW - ${liquidator} ${borrower}
		    ${this.underlyingToken.formatAmount(repayAmount)} ${this.underlyingToken.symbol} repaid
		    ${collateralContract._data.token.formatAmount(seizeTokens.toString())} ${collateralContract._data.token.symbol} collateral seized`);

		let borrowerData = borrower in accounts ? accounts[borrower][cTokenContract.address] : undefined;

		if (borrowerData !== undefined) {
		    borrowerData.borrows = borrowerData.borrows.sub(repayAmount);
		}
	    };

	    this.doTransfer = ({from, to, amount}) => {
                let src = from;
                let dst = to;

		// Token balances were adjusted by amount, if src or dst is the contract itself update totalSupply
		let srcTracker = src in accounts ? accounts[src][cTokenContract.address] : undefined;
		let dstTracker = dst in accounts ? accounts[dst][cTokenContract.address] : undefined;

		let srcBalance = constants.ZERO;
		let dstBalance = constants.ZERO;

		if (src == cTokenContract.address) {
		    // Mint - add tokens to total supply
		    srcBalance = this.totalSupply = this.totalSupply.add(amount);
		} else {
		    if (srcTracker !== undefined) {
			srcBalance = srcTracker.tokens = srcTracker.tokens.sub(amount);
		    }
		}

		 if (dst == cTokenContract.address) {
		    // Redeem - remove tokens from total supply
		    dstBalance = this.totalSupply = this.totalSupply.sub(amount);
		} else {
		    if (dstTracker !== undefined) {
			dstBalance = dstTracker.tokens = dstTracker.tokens.add(amount);
		    }
		}

		let underlying = this.underlyingToken;

		let fmtAddr = (addr) => addr == cTokenContract.address ? 'MARKET' : addr;

		console.log(`[${this.underlyingToken.symbol}] TRANSFER ${fmtAddr(src)} => ${fmtAddr(dst)}
		    ${this.token.formatAmount(amount)} ${this.token.symbol} transferred`);
	    };

            // TODO this is wrong
            /*
	    this.doReservesAdded = ({admin, amountReduced, totalReservesNew}) => {
		console.log(`[${this.underlyingToken.symbol}] RESERVES_REDUCED
		    +${this.underlyingToken.formatAmount(amountAdded)} ${this.underlyingToken.symbol}
		    ${this.underlyingToken.formatAmount(totalReservesNew)} ${this.underlyingToken.symbol}`);

		this.totalReserves = totalReservesNew;
		this.totalCash = this.totalCash.sub(amountReduced);
	    };*/

            // TODO reserves reduced

            this.doFailure = () => {
                // Nothing to do here
            }

            this.doApproval = () => {
                // Nothing to do here
            }

            // End constructor
        })();


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
    let accountsMap = accountsGlobal;

    // Load into data structure
    for (let account of allAccounts) {
        let accountAddress = ethers.utils.getAddress(account.address); // checksum case

        accountsMap[accountAddress] = { 
            liquidated: false,
            address: accountAddress
        };

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
            };

            accountsMap[accountAddress][marketAddress] = tracker;
        }
    }

    return accountsMap;
}

const getComptroller = async () => {
    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, ethers.provider);

    await comptrollerContract.deployed();

    CLOSE_FACTOR_MANTISSA = await comptrollerContract.closeFactorMantissa();

    console.log(`COMPTROLLER CLOSE FACTOR MANTISSA ${CLOSE_FACTOR_MANTISSA.toString()}`);

    LIQUIDATION_INCENTIVE_MANTISSA = await comptrollerContract.liquidationIncentiveMantissa();

    console.log(`COMPTROLLER LIQUIDATION INCENTIVE MANTISSA ${LIQUIDATION_INCENTIVE_MANTISSA.toString()}`);

    comptrollerContractGlobal = comptrollerContract;

    return comptrollerContract;
}

const getUniswapOracle = async () => {
    let uniswapAnchoredViewContract = new ethers.Contract(UNISWAP_ANCHORED_VIEW_ADDRESS, UNISWAP_ANCHORED_VIEW_ABI, ethers.provider);

    await uniswapAnchoredViewContract.deployed();

    return uniswapAnchoredViewContract;
}

const getLiquidator = async (operatingAccount) => {
    const liqDeployment = await deployments.get("CompoundLiquidator");

    // Connect this contract to the operating signer, this is the only contract to which we send signed transactions
    liquidatorContractGlobal = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address, operatingAccount);

    let operatingAddress = await operatingAccount.getAddress();
    assert(await liquidatorContractGlobal.owner() == operatingAddress);

    console.log(`LIQUIDATOR DEPLOYED @ ${liquidatorContractGlobal.address}`);

    return liquidatorContractGlobal;
}

const getLiquidatorWrapper = async (operatingAccount) => {
    const liqWrapperDeployment = await deployments.get("CompoundLiquidatorWrapper");

    // Connect this contract to the operating signer, this is the only contract to which we send signed transactions
    liquidatorWrapperContractGlobal = await ethers.getContractAt("CompoundLiquidatorWrapper", liqWrapperDeployment.address, operatingAccount);

    let operatingAddress = await operatingAccount.getAddress();
    assert(await liquidatorWrapperContractGlobal.owner() == operatingAddress);

    console.log(`LIQUIDATOR WRAPPER DEPLOYED @ ${liquidatorWrapperContractGlobal.address}`);

    return liquidatorWrapperContractGlobal;
}

const getUniswapFactory = async () => {
	uniswapFactoryContractGlobal = await ethers.getContractAt("IUniswapV2Factory", UNISWAP_FACTORY_ADDRESS);
	return uniswapFactoryContractGlobal;
}

const updateGasPrice = async () => {
    try {
	let result = await axios.get(`https://api.etherscan.io/api?module=gastracker&action=gasoracle&apikey=${ETHERSCAN_API_KEY}`);

	// {"LastBlock":"10772578","SafeGasPrice":"235","ProposeGasPrice":"258","FastGasPrice":"270"}
	console.log(`GAS RESULT (etherscan) ${JSON.stringify(result.data)}`);

	gasPriceGlobal = ethers.utils.parseUnits(result.data.result.FastGasPrice, 'gwei');
    } catch (err) {
        // Try getting the gas price from the provider directly (costs requests)
        gasPriceGlobal = await ethers.provider.getGasPrice();

        console.log(`GAS RESULT (provider) ${ethers.utils.formatUnits(gasPriceGlobal, 'gwei')}`);
    }

    let task = new Promise(resolve => setTimeout(resolve, 30 * 1000));
    task.then(() => updateGasPrice());
}

const loadOperatingAccount = async () => {
    // Load the operating address, 0th in buidler configuration
    let signers = await ethers.getSigners();
    let operatingAccount = signers[0];
    operatingAccountGlobal = operatingAccount;

    let operatingAddress = await operatingAccount.getAddress();
    await updateAccountBalance(operatingAddress);

    return operatingAccount;
}

const updateAccountBalance = async (operatingAddress) => {
    let operatorBalance = await ethers.provider.getBalance(operatingAddress);
    operatingAccountBalanceGlobal = operatorBalance;

    console.log(`OPERATING ACCOUNT ${operatingAddress} BALANCE ${ethers.utils.formatEther(operatorBalance)}`);

    let task = new Promise(resolve => setTimeout(resolve, 30 * 1000));
    task.then(() => updateAccountBalance(operatingAddress));

    return operatorBalance;
}

const updateExternalPrices = async () => {
    let response = await axios.get('https://prices.compound.finance');
    let {coinbase} = response.data;
    console.log(`FETCHED COINBASE PRICES: ${JSON.stringify(coinbase.prices)}`);

    const updatedCoinbasePrices = {};
    for(let i = 0; i < coinbase.messages.length; i++) {
	let [kind, timestamp, symbol, price] = ethers.utils.defaultAbiCoder.decode(['string', 'uint64', 'string', 'uint64'], coinbase.messages[i]);
	let normalizedSymbol = symbol === 'BTC' ? 'WBTC' : symbol;
	updatedCoinbasePrices[normalizedSymbol] = {
	    message: coinbase.messages[i],
	    signature: coinbase.signatures[i],
	    rawSymbol: symbol,
	    normalizedSymbol,
	    rawPrice: price, // this is the raw price, same as what comes thru on onPriceUpdate
	    normalizedPrice: normalizeRawPrice(price),
	    timestamp,
	}
    }
    coinbasePricesGlobal = updatedCoinbasePrices;
    
    let task = new Promise(resolve => setTimeout(resolve, 10 * 1000));
    task.then(() => updateExternalPrices());
}

const run = async () => {
    await sendMessage('LIQUIDATOR', 'starting...');

    let operatingAccount = await loadOperatingAccount();

    let liquidator = await getLiquidator(operatingAccount);

    let liquidatorWrapper = await getLiquidatorWrapper(operatingAccount);

    await tokens.TokenFactory.init();

    await updateGasPrice();

    await updateExternalPrices();

    console.log('READY LITTYQUIDATOR 1');

    let comptrollerContract = await getComptroller();

    let uniswapOracle = await getUniswapOracle();

    await getUniswapFactory();

    // Start from some blocks back
    let blockNumber = await ethers.provider.getBlockNumber();

    let startBlock = blockNumber - 15;

    console.log(`STARTING FROM BLOCK NUMBER ${startBlock}`);

    // Load markets from start block
    let markets = await getMarkets(comptrollerContract, uniswapOracle, startBlock);

    // Fetch accounts from REST service
    let accounts = await getAccounts(markets, startBlock);

    let lastBlock = startBlock;

    while (true) {
    	// Just log to csv everytime, TODO remove after validating
	(async () => {
	    const csv = new ObjectsToCsv(liquidationRecords);

	    // Save to file:
	    await csv.toDisk('./liquidationRecords.csv');
	})();

        // fetch the latest block
        let blockNumber = await ethers.provider.getBlockNumber();

        if (blockNumber === lastBlock) {
            console.log(`NO NEW BLOCK`);
            await new Promise( resolve => setTimeout( resolve, 5 * 1000 ) );
            continue;
        }

        console.log(`UPDATING FOR BLOCKS [${lastBlock + 1} - ${blockNumber}]`);

        // collect provider tasks
        let tasks = []

	for (let market of Object.values(markets)) {
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

        // apply events in order to state
        for (let ev of allEvents) {
            if (!('event' in ev)) {
                // possible issue with the events abi
                throw new Error(`unhandled event ${JSON.stringify(ev)}`);
            }

            console.log(`EVENT block ${ev.blockNumber} tx ${ev.transactionHash} logIdx ${ev.logIndex}`);

            if (ev.address === comptrollerContract.address) {
                if (ev['event'] === 'MarketEntered') {
                    onMarketEntered(ev.args);
                } else if (ev['event'] === 'MarketExited') {
                    onMarketExited(ev.args);
                }
            } else if (ev.address === uniswapOracle.address) {
                if (ev['event'] === 'PriceUpdated') {
		    onPriceUpdated(ev.args.symbol, ev.args.price, markets);                
                }
            } else {
		let eventHandler = markets[ev.address]._data['do' + ev['event']]

                try {
		    eventHandler(ev.args);
                } catch (err) {
                    console.log(ev);
                    throw err;
                }
            }
        }

        // update last block
        lastBlock = blockNumber;

        // dont spam the log if no events
        if (allEvents.length == 0) {
            console.log('NO EVENTS');
            continue;
        }

        // try liquidation with updated state
        doLiquidation();
    }
}

module.exports = async (isLive) => {
    console.log("COMPILING...");
    
    await bre.run("compile");

    console.log(`STARTING live=${isLive}`);

    isLiveGlobal = isLive;

    process.on('unhandledRejection', async (err) => {
        console.error(`UNHANDLED REJECTION ${err}`);

        await sendMessage('ERROR', `process exited - ${err}`);

        process.exit();
    });

    try {
        await run();
    } catch (err) {
        console.error(`EXCEPTION ${err}`);

        await sendMessage('ERROR', `process exited - ${err}`);
        
        throw err;
    }
}
