const { deployments } = require("@nomiclabs/buidler");

const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;
const assert = require('assert');

const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';

const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';

const CDAI = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const CETH = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
const CUSDC = '0x39aa39c021dfbae8fac545936693ac917d5e7563';

const DAI_USDC_PAIR = '0xAE461cA67B15dc8dc81CE7615e0320dA1A9aB8D5';
const DAI_WETH_PAIR = '0xA478c2975Ab1Ea89e8196811F51A7B7Ade33eB11';

const COMPTROLLER_ADMIN = '0x6d903f6003cca6255D85CcA4D3B5E5146dC33925';

const DAI_WHALE = "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C";
const ETH_WHALE = "0x742d35cc6634c0532925a3b844bc454e4438f44e";

const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

describe("Liquidator", async () => {
    let liquidatorContract;
    let comptrollerContract;
    let oracleContract;

    let ownerAccount;
    let ownerAccountAddress;

    before(async () => {
        let signers = await ethers.getSigners();
        ownerAccount = signers[0];
        ownerAccountAddress = await ownerAccount.getAddress();

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
        await signers[9].sendTransaction({
            to: COMPTROLLER_ADMIN,
            value: ethers2.utils.parseEther('0.1'),
        });

        let compAdmin = await ethers.provider.getSigner(COMPTROLLER_ADMIN);
        await comptrollerContract.connect(compAdmin)._setPriceOracle(oracleContract.address);
        expect(await comptrollerContract.oracle()).to.equal(oracleContract.address);
    });

    it('DAI-WETH', async () => {
        let signers = await ethers.getSigners();
        const borrowingAccount = signers[1];
        const borrowAccountAddress = await borrowingAccount.getAddress();
        await comptrollerContract.connect(borrowingAccount).enterMarkets([CDAI, CUSDC]);
        await liquidatorContract.enterMarkets(COMPTROLLER_ADDRESS, [CDAI, CUSDC]);

        // Set prices to 1
        let priceOne = ethers2.utils.parseEther('1');
        await oracleContract.setUnderlyingPrice(CDAI, priceOne);
        await oracleContract.setUnderlyingPrice(CUSDC, priceOne.mul(ethers2.BigNumber.from(10).pow(12)));

        expect(await oracleContract.getUnderlyingPrice(CDAI)).to.equal(priceOne);
        expect(await oracleContract.getUnderlyingPrice(CUSDC)).to.equal(priceOne.mul(ethers2.BigNumber.from(10).pow(12)));

        const daiBorrowAmount = ethers2.utils.parseUnits('2');
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

        console.log(`sending pair ${usdcReserve} dai`);
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

        await liquidatorContract.connect(ownerAccount).withdraw(dai.address);
        expect(await dai.balanceOf(ownerAccountAddress)).to.equal(strategyDaiBalance);
    });

    it('DAI-ETH', async () => {
        let signers = await ethers.getSigners();
        const borrowingAccount = signers[2];
        const borrowAccountAddress = await borrowingAccount.getAddress();
        await comptrollerContract.connect(borrowingAccount).enterMarkets([CDAI, CETH]);
        await liquidatorContract.enterMarkets(COMPTROLLER_ADDRESS, [CDAI, CETH]);

        const pair = await ethers.getContractAt('IUniswapV2Pair', DAI_WETH_PAIR);
        let [daiReserve, wethReserve, blockTimestampLast] = await pair.getReserves();
        let wethToDai = daiReserve.div(wethReserve);
        console.log(`pair initial dai reserve ${daiReserve}`);
        console.log(`pair initial weth reserve ${wethReserve}`);
        console.log(`dai/weth price ${wethToDai}`);

        // Set prices to 1
        let priceOne = ethers2.utils.parseEther('1');
        // Since dai is $1 and weth/dai both have mantissa of 18, we can treat this is the weth price in $
        let wethToDaiInEther = ethers2.utils.parseEther(wethToDai.toString());
        await oracleContract.setUnderlyingPrice(CDAI, priceOne);
        await oracleContract.setUnderlyingPrice(CETH, wethToDaiInEther);

        expect(await oracleContract.getUnderlyingPrice(CDAI)).to.equal(priceOne);
        expect(await oracleContract.getUnderlyingPrice(CETH)).to.equal(wethToDaiInEther);

        const daiLendAmount = wethToDaiInEther;
        console.log(`daiLendAmount: ${daiLendAmount}`);
        const daiWhale = await ethers.provider.getSigner(DAI_WHALE);
        const dai = await ethers.getContractAt('MyERC20', legos.erc20.dai.address);
        await dai.connect(daiWhale).transfer(borrowAccountAddress, daiLendAmount);
        const whaleDaiAmount = await dai.balanceOf(DAI_WHALE);
        console.log(`whale dai amount: ${whaleDaiAmount}`);

        // Mint cDai i.e. provide collateral
        const cDai = await ethers.getContractAt('ICERC20', CDAI);
        await dai.connect(borrowingAccount).approve(CDAI, daiLendAmount);
        await cDai.connect(borrowingAccount).mint(
            daiLendAmount,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );
        // get cDai balance
        let [cDAIError, cDaiBalance, daiBorrowBalance, cDaiExchangeRateMantissa] = (await cDai.getAccountSnapshot(borrowAccountAddress));
        console.log("cDai balance after mint: ", cDaiBalance.toString());
        console.log("dai borrow balance after mint: ", daiBorrowBalance.toString());
        console.log("dai exchange rate mantissa after mint: ", cDaiExchangeRateMantissa.toString());

        let [isListed, daiCollateralFactor] = await comptrollerContract.markets(CDAI);
        console.log(`cDai collateral factor: ${daiCollateralFactor}`);

        // get account liquidity
        let [err, liquidity, shortfall] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error: ", err.toString());
        console.log("liquidity before borrow: ", liquidity.toString());
        console.log("liquidity before borrow: ", shortfall.toString());

        const cETH = await ethers.getContractAt('ICEther', CETH);
        // const ethBorrowAmount = ethers2.utils.parseEther('1').mul(daiCollateralFactor).div(ethers2.BigNumber.from(10).pow(18));
        const ethBorrowAmount = ethers2.utils.parseEther('.74');
        console.log(`ethBorrowAmount: ${ethBorrowAmount}`);
        await cETH.connect(borrowingAccount).borrow(
            ethBorrowAmount,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        let [cETHError, cETHBalance, ETHBorrowBalance, cETHExchangeRateMantissa] = await cETH.getAccountSnapshot(borrowAccountAddress);
        console.log("cEth balance after borrow: ", cETHBalance.toString());
        console.log("ETH borrow balance after borrow: ", ETHBorrowBalance.toString());
        console.log("cETH exchange rate mantissa after borrow: ", cETHExchangeRateMantissa.toString());

        let [err2, liquidity2, shortfall2] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error after borrow: ", err2.toString());
        console.log("liquidity after borrow: ", liquidity2.toString());
        console.log("shortfall after borrow: ", shortfall2.toString());

        // // Get rekt
        // update weth price by 10%, whale should be able to cover the necessary dai amount
        console.log('update prices');
        const additionalDaiReserve = daiReserve.div(10);
        console.log(`sending pair ${additionalDaiReserve} dai`);
        await dai.connect(daiWhale).transfer(DAI_WETH_PAIR, additionalDaiReserve);
        console.log(`syncing pair`);
        await pair.sync({
            gasLimit: 5 * 10**6
        });
        console.log('pair synced');

        let [daiReserveUpdated, wethReserveUpdated, blockTimestampLastUpdated] = await pair.getReserves();
        let wethToDaiUpdated = daiReserveUpdated.div(wethReserveUpdated);
        console.log(`pair update dai reserve ${daiReserveUpdated}`);
        console.log(`pair update weth reserve ${wethReserveUpdated}`);
        console.log(`dai/weth update price ${wethToDaiUpdated}`);
        let wethToDaiInEtherUpdated = ethers2.utils.parseEther(wethToDaiUpdated.toString());

        console.log(`a blackswan appeared, ETH went to ${wethToDaiUpdated}`);
        console.log(`updatedWethToDaiInEther: ${wethToDaiInEtherUpdated}`);
        await oracleContract.setUnderlyingPrice(CETH, wethToDaiInEtherUpdated);
        expect(await oracleContract.getUnderlyingPrice(CETH)).to.equal(wethToDaiInEtherUpdated);

        let [err3, liquidity3, shortfall3] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("liquidity after price change: ", liquidity3.toString());
        console.log("shortfall after price change: ", shortfall3.toString());

        var repayBorrowAmount = ethBorrowAmount.div(100);
        console.log(`repayAmount ${repayBorrowAmount}`);

        let result = await liquidatorContract.liquidate(
            borrowAccountAddress,
            CETH,
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

        let prevOwnerDaiBalance = await dai.balanceOf(ownerAccountAddress); // second test, residual balance
        await liquidatorContract.connect(ownerAccount).withdraw(dai.address);
        let newOwnerDaiBalance = await dai.balanceOf(ownerAccountAddress);
        expect(newOwnerDaiBalance.sub(prevOwnerDaiBalance)).to.equal(strategyDaiBalance);
    });

    it('ETH-TOKEN', async () => {
        let signers = await ethers.getSigners();
        const borrowingAccount = signers[3];
        const borrowAccountAddress = await borrowingAccount.getAddress();
        await comptrollerContract.connect(borrowingAccount).enterMarkets([CDAI, CETH]);
        await liquidatorContract.enterMarkets(COMPTROLLER_ADDRESS, [CDAI, CETH]);

        const pair = await ethers.getContractAt('IUniswapV2Pair', DAI_WETH_PAIR);
        let [daiReserve, wethReserve, blockTimestampLast] = await pair.getReserves();
        let wethToDai = daiReserve.div(wethReserve);
        console.log(`pair initial dai reserve ${daiReserve}`);
        console.log(`pair initial weth reserve ${wethReserve}`);
        console.log(`dai/weth price ${wethToDai}`);

        // Set prices to 1
        let priceOne = ethers2.utils.parseEther('1');
        // Since dai is $1 and weth/dai both have mantissa of 18, we can treat this is the weth price in $
        let wethToDaiInEther = ethers2.utils.parseEther(wethToDai.toString());
        await oracleContract.setUnderlyingPrice(CDAI, priceOne);
        await oracleContract.setUnderlyingPrice(CETH, wethToDaiInEther);

        expect(await oracleContract.getUnderlyingPrice(CDAI)).to.equal(priceOne);
        expect(await oracleContract.getUnderlyingPrice(CETH)).to.equal(wethToDaiInEther);


        const ethLendAmount = ethers2.utils.parseEther('1');
        const ethWhale = await ethers.provider.getSigner(ETH_WHALE);
        await ethWhale.sendTransaction({
            to: borrowAccountAddress,
            value: ethLendAmount,
        });

        // Mint cETH i.e. provide collateral
        const cEth = await ethers.getContractAt('ICEther', CETH);
        await cEth.connect(borrowingAccount).mint({value: ethLendAmount, gasLimit: 5 * 10**6});

        let [cETHError, cETHBalance, cETHBorrowBalance, cETHExchangeRateMantissa] = (await cEth.getAccountSnapshot(borrowAccountAddress));
        console.log("cETH balance after mint: ", cETHBalance.toString());
        console.log("eth borrow balance after mint: ", cETHBorrowBalance.toString());
        console.log("eth exchange rate mantissa after mint: ", cETHExchangeRateMantissa.toString());

        // get account liquidity
        let [err, liquidity, shortfall] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error: ", err.toString());
        console.log("liquidity before borrow: ", liquidity.toString());
        console.log("liquidity before borrow: ", shortfall.toString());

        let [isListed, ethCollateralFactor] = await comptrollerContract.markets(CETH);
        console.log(`cETH collateral factor: ${ethCollateralFactor}`);

        const cDai = await ethers.getContractAt('ICERC20', CDAI);
        const daiBorrowAmount = wethToDaiInEther.mul(74).div(100);
        console.log(`ethBorrowAmount: ${ethLendAmount}`);
        await cDai.connect(borrowingAccount).borrow(
            daiBorrowAmount,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        let [cDaiError, cDAIBalance, DAIBorrowBalance, cDAIExchangeRateMantissa] = await cDai.getAccountSnapshot(borrowAccountAddress);
        console.log("cDAI balance after borrow: ", cDAIBalance.toString());
        console.log("DAI borrow balance after borrow: ", DAIBorrowBalance.toString());
        console.log("cDAI exchange rate mantissa after borrow: ", cDAIExchangeRateMantissa.toString());

        let [err2, liquidity2, shortfall2] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("error after borrow: ", err2.toString());
        console.log("liquidity after borrow: ", liquidity2.toString());
        console.log("shortfall after borrow: ", shortfall2.toString());

        // // Get rekt
        // update dai price by 10%, whale should be able to cover the necessary dai amount
        console.log('update prices');
        const additionalWETHReserve = wethReserve.div(10);
        console.log(`sending pair ${additionalWETHReserve} weth`);
        const weth = await ethers.getContractAt('WETH9', WETH);
        console.log('depositing weth');
        await weth.connect(ethWhale).deposit({value: additionalWETHReserve, gasLimit: 5 * 10**6});
        console.log('sending weth to pair');
        await weth.connect(ethWhale).transfer(DAI_WETH_PAIR, additionalWETHReserve, {gasLimit: 5 * 10**6});
        console.log(`syncing pair`);
        await pair.sync({
            gasLimit: 5 * 10**6
        });
        console.log('pair synced');

        let [daiReserveUpdated, wethReserveUpdated, blockTimestampLastUpdated] = await pair.getReserves();
        let wethToDaiUpdated = daiReserveUpdated.div(wethReserveUpdated);
        console.log(`pair update dai reserve ${daiReserveUpdated}`);
        console.log(`pair update weth reserve ${wethReserveUpdated}`);
        console.log(`dai/weth update price ${wethToDaiUpdated}`);
        let wethToDaiInEtherUpdated = ethers2.utils.parseEther(wethToDaiUpdated.toString());

        console.log(`a blackswan appeared, ETH went to ${wethToDaiUpdated}`);
        console.log(`updatedWethToDaiInEther: ${wethToDaiInEtherUpdated}`);
        await oracleContract.setUnderlyingPrice(CETH, wethToDaiInEtherUpdated);
        expect(await oracleContract.getUnderlyingPrice(CETH)).to.equal(wethToDaiInEtherUpdated);

        let [err3, liquidity3, shortfall3] = await comptrollerContract.getAccountLiquidity(borrowAccountAddress);
        console.log("liquidity after price change: ", liquidity3.toString());
        console.log("shortfall after price change: ", shortfall3.toString());

        const initialWethBalance = await weth.connect(liquidatorContract.address).balanceOf(liquidatorContract.address);
        console.log(`initial weth balance: ${initialWethBalance}`);

        var repayBorrowAmount = daiBorrowAmount.div(100);
        console.log(`repayAmount ${repayBorrowAmount}`);

        let result = await liquidatorContract.liquidate(
            borrowAccountAddress,
            CDAI,
            CETH,
            repayBorrowAmount,
            UNISWAP_FACTORY,
            {
                gasLimit: 5 * 10**6, // estimate gas on ganache has bug
            }
        );

        let txDone = await result.wait();

        const finalWethBalance = await weth.connect(liquidatorContract.address).balanceOf(liquidatorContract.address);
        console.log(`final weth balance: ${finalWethBalance}`);
        expect(true).to.equal(finalWethBalance.gt(0));

        await liquidatorContract.connect(ownerAccount).withdraw(weth.address);
        expect(await weth.balanceOf(ownerAccountAddress)).to.equal(finalWethBalance);
    });
});
