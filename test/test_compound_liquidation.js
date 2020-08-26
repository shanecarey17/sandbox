const { deployments } = require("@nomiclabs/buidler");

const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;
const assert = require('assert');

const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const COMPTROLLER_IMPL_ADDRESS = '0xAf601CbFF871d0BE62D18F79C31e387c76fa0374';

const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

const LIQUIDATE_ACCOUNT = '0x24F700BBa64905C97dD9F1cAc3DAcA8BA81f0285';

//const CTOKEN_BORROWED = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'; // cDAI
//const CTOKEN_COLLATERAL = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5'; // cETH
const CTOKEN_COLLATERAL = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'; // cDAI
const CTOKEN_BORROWED = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5'; // cETH

const CDAI = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const CETH = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
const CWBTC = '0xc11b1268c1a384e55c48c2391d8d480264a3a7f4';
const CUSDC = '0x39aa39c021dfbae8fac545936693ac917d5e7563';

const DAI = '0x6b175474e89094c44da98b954eedeac495271d0f';
const WBTC = '0x2260fac5e5542a773aa44fbcfedf7c193bc2c599';
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';

const USDC_WHALE = "0x8cee3eeab46774c1cde4f6368e3ae68bccd760bf";

const DAI_USDC_PAIR = '0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5';

const COMPTROLLER_ADMIN = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';

describe("Liquidator", async () => {
    let liquidatorContract;
    let comptrollerContract;
    let oracleContract;

    let borrowingAccount;
    let liquidatingAccount;
    
    before(async () => {
        // Load accounts
        let signers = await ethers.getSigners();

        borrowingAccount = signers[0];
        liquidatingAccount = signers[1];

        // Deploy liquidator
        await deployments.fixture('liquidator'); // tag
        const liqDeployment = await deployments.get("CompoundLiquidator");
        const liquidator = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);
        liquidatorContract = liquidator;

        // Get comptroller
        comptrollerContract = await ethers.getContractAt("IComptroller", COMPTROLLER_ADDRESS);

        // Setup oracle
        let oracleFactory = await ethers.getContractFactory("TestCompoundPriceOracle");
        oracleContract = await oracleFactory.deploy();

        // give some gas to set oracle
        await borrowingAccount.sendTransaction({
            to: COMPTROLLER_ADMIN,
            value: ethers2.utils.parseEther('0.1'),
        });
        let compAdmin = await ethers.provider.getSigner(COMPTROLLER_ADMIN);
        await comptrollerContract.connect(compAdmin)._setPriceOracle(oracleContract.address);
        expect(await comptrollerContract.oracle()).to.equal(oracleContract.address);
        
        // Enter markets
        await liquidator.enterMarkets(COMPTROLLER_ADDRESS, [CDAI, CETH, CWBTC]);
        await comptrollerContract.connect(borrowingAccount).enterMarkets([CDAI, CETH, CWBTC]);

        // Set prices to 1
        let priceOne = ethers2.utils.parseEther('1');
        await oracleContract.setUnderlyingPrice(CDAI, priceOne); 
        await oracleContract.setUnderlyingPrice(CWBTC, priceOne.mul(ethers2.BigNumber.from(10).pow(10)));
        await oracleContract.setUnderlyingPrice(CUSDC, priceOne.mul(ethers2.BigNumber.from(10).pow(12)));
        await oracleContract.setUnderlyingPrice(CETH, priceOne);

        expect(await oracleContract.getUnderlyingPrice(CDAI)).to.equal(priceOne);
        expect(await oracleContract.getUnderlyingPrice(CWBTC)).to.equal(priceOne.mul(ethers2.BigNumber.from(10).pow(10)));
        expect(await oracleContract.getUnderlyingPrice(CUSDC)).to.equal(priceOne.mul(ethers2.BigNumber.from(10).pow(12)));
        expect(await oracleContract.getUnderlyingPrice(CETH)).to.equal(priceOne);
    });

    it.skip('test uniswap manipulation', async () => {
        const USDC_WHALE = "0x8cee3eeab46774c1cde4f6368e3ae68bccd760bf";
        const usdcWhale = await ethers.provider.getSigner(USDC_WHALE);
        const usdc = await ethers.getContractAt('MyERC20', USDC);
        const whaleusdcBalance = await usdc.balanceOf(USDC_WHALE);
        console.log(`whale usdc amount: ${whaleusdcBalance.toString()}`);

        const pair = await ethers.getContractAt('IUniswapV2Pair', DAI_USDC_PAIR);
        let [daiReserve, usdcReserve, blockTimestampLast] = await pair.getReserves();
        console.log(`dai reserve: ${daiReserve.toString()}`);
        console.log(`usdc reserve: ${usdcReserve.toString()}`);
        console.log(`dai usdc price: ${daiReserve.div(usdcReserve).toString()}`);

        console.log(`sending pair ${usdcReserve} usdc`);
        await usdc.connect(usdcWhale).transfer(DAI_USDC_PAIR, usdcReserve);
        console.log(`syncing pair`);
        await pair.sync({
            gasLimit: 5 * 10**6
        });
        console.log('pair synced');

        console.log('Getting synced reserves');
        let [daiReserve2, usdcReserve2, blockTimestampLast2] = await pair.getReserves();
        console.log(`dai reserve: ${daiReserve2.toString()}`);
        console.log(`usdc reserve: ${usdcReserve2.toString()}`);
        console.log(`dai usdc price: ${daiReserve2.div(usdcReserve2).toString()}`);
    });

    it('TOKEN-TOKEN', async () => {
        const borrowAccountAddress = await borrowingAccount.getAddress();

        const daiBorrowAmount = ethers2.utils.parseUnits('2');
        const DAI_WHALE = "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C";
        const daiWhale = await ethers.provider.getSigner(DAI_WHALE);
        const dai = await ethers.getContractAt('MyERC20', legos.erc20.dai.address);
        await dai.connect(daiWhale).transfer(borrowAccountAddress, daiBorrowAmount);

        // Mint cDai i.e. provide collateral
        const cDai = await ethers.getContractAt('ICERC20', CDAI);
        const cDaiBalanceInitial = (await cDai.getAccountSnapshot(borrowAccountAddress))[1];
        console.log("cDai balance before liquidation: ", cDaiBalanceInitial.toString());

        await dai.connect(borrowingAccount).approve(CDAI, daiBorrowAmount);
        await cDai.connect(borrowingAccount).mint(
            daiBorrowAmount,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );
        // get cDai balance
        let [cDAIError, cDaiBalance, daiBorrowBalance, cDaiExchangeRateMantissa] = (await cDai.getAccountSnapshot(borrowAccountAddress));
        console.log("cDai balance after mint: ", cDaiBalance.toString());
        console.log("dai borrow balance after mint: ", daiBorrowBalance.toString());
        console.log("dai exchange rate mantissa after mint: ", cDaiExchangeRateMantissa.toString());

        // get account liquidity
        let [err, liquidity, shortfall] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("liquidity before borrow: ", liquidity.toString());

        const cUSDC = await ethers.getContractAt('ICERC20', CUSDC);
        await cUSDC.connect(borrowingAccount).borrow(
            ethers2.utils.parseUnits('1').div(ethers2.BigNumber.from(10).pow(12)),
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        // get wbtc balance
        let [cUSDCError, cUSDCBalance, USDCBorrowBalance, cUSDCExchangeRateMantissa] = await cUSDC.getAccountSnapshot(borrowAccountAddress);
        console.log("cUSDC balance after borrow: ", cUSDCBalance.toString());
        console.log("USDC borrow balance after borrow: ", USDCBorrowBalance.toString());
        console.log("cUSDC exchange rate mantissa after borrow: ", cUSDCExchangeRateMantissa.toString());

        let [err2, liquidity2, shortfall2] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error after borrow: ", err2.toString());
        console.log("liquidity after borrow: ", liquidity2.toString());
        console.log("shortfall after borrow: ", shortfall2.toString());

        // // Get rekt
        console.log("a blackswan appeared, USDC went to $2");
        await oracleContract.setUnderlyingPrice(CUSDC, ethers2.utils.parseEther('2').mul(ethers2.BigNumber.from(10).pow(12)));

        let [err3, liquidity3, shortfall3] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error after price change: ", err3.toString());
        console.log("liquidity after price change: ", liquidity3.toString());
        console.log("shortfall after price change: ", shortfall3.toString());

        const pair = await ethers.getContractAt('IUniswapV2Pair', DAI_USDC_PAIR);
        let [daiReserve, usdcReserve, blockTimestampLast] = await pair.getReserves();
        console.log(`current uniswap dai reserve: ${daiReserve.toString()}`);
        console.log(`current uniswap  usdc reserve: ${usdcReserve.toString()}`);
        console.log(`current uniswap  dai/usdc price: ${daiReserve.div(usdcReserve).toString()}`);

        console.log(`sending pair ${usdcReserve} usdc`);
        await dai.connect(daiWhale).transfer(DAI_USDC_PAIR, daiReserve);
        console.log(`syncing pair`);
        await pair.sync({
            gasLimit: 5 * 10**6
        });
        console.log('pair synced');

        let [daiReserve2, usdcReserve2, blockTimestampLast2] = await pair.getReserves();
        console.log(`synced uniswap dai reserve: ${daiReserve2.toString()}`);
        console.log(`synced uniswap  usdc reserve: ${usdcReserve2.toString()}`);
        console.log(`synced uniswap  dai/usdc price: ${daiReserve2.div(usdcReserve2).toString()}`);

        var repayBorrowAmount = ethers2.utils.parseUnits('.1').div(ethers2.BigNumber.from(10).pow(12));

        let result = await liquidatorContract.liquidate(
            borrowAccountAddress,
            CUSDC,
            CDAI,
            repayBorrowAmount,
            UNISWAP_FACTORY,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        let txDone = await result.wait();

        console.log(`GAS USED ${txDone.gasUsed.toString()}`);
        const strategyDaiBalance = await dai.balanceOf(liquidatorContract.address);
        console.log(`liquidator dai balance: ${strategyDaiBalance.toString()}`);
        expect(true).to.equal(strategyDaiBalance.gt(0));
    });

    it.skip('TOKEN-ETH', async () => {

    });

    it.skip('ETH-TOKEN', async () => {
         console.log('HERE');
    });

    it.skip("Should work", async () => {
        // Get borrowed amount
        const borrowedContract = await ethers.getContractAt("ICToken", CTOKEN_BORROWED);

        let borrowedAmount = await borrowedContract.borrowBalanceStored(LIQUIDATE_ACCOUNT);

        console.log(`BORROWED AMOUNT ${ethers2.utils.formatUnits(borrowedAmount)} DAI`);

        const collateralContract = await ethers.getContractAt('ICToken', CTOKEN_COLLATERAL);

        let collateralAmount = await collateralContract.balanceOf(LIQUIDATE_ACCOUNT);

        console.log(`COLLATERAL AMOUNT ${ethers2.utils.formatUnits(collateralAmount)} cETH`);

        const comptrollerContract = await ethers.getContractAt("IComptroller", COMPTROLLER_ADDRESS);

        // Get max repay percent
        let closeFactorMantissa = await comptrollerContract.closeFactorMantissa();

        console.log(`CLOSE FACTOR ${closeFactorMantissa / ethers2.BigNumber.from(10).pow(18)}`);

        // Do the liquidation
        const liqDeployment = await deployments.get("CompoundLiquidator");
        const liquidator = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);

        await liquidator.enterMarkets(COMPTROLLER_ADDRESS, [CTOKEN_BORROWED, CTOKEN_COLLATERAL]);

        console.log('ENTERED MARKETS');

        let [err, liquidity, shortfall] = await comptrollerContract.getAccountLiquidity(LIQUIDATE_ACCOUNT);

        console.log(`LIQUIDATE ACCOUNT liquidity ${liquidity.toString()} shortfall ${shortfall.toString()}`);

        var repayBorrowAmount = ethers2.utils.parseUnits('0.01');

        liquidator.once('Success', (profit) => {
            console.log(`SUCCESS profit<${profit.toString()}>`);
        });

        let result = await liquidator.liquidate(
            LIQUIDATE_ACCOUNT,
            CTOKEN_BORROWED,
            CTOKEN_COLLATERAL,
            repayBorrowAmount,
            UNISWAP_FACTORY,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        console.log(`RESULT ${JSON.stringify(result, null, 4)}`);

        let txDone = await result.wait();

        console.log(`GAS USED ${txDone.gasUsed.toString()}`);
    });


    after(async () => {
        // Give ganache some time to log the error
        await new Promise(resolve => setTimeout(resolve, 10000));
    });
});
