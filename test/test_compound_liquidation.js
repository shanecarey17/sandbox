const { deployments } = require("@nomiclabs/buidler");

const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;

const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const LIQUIDATE_ACCOUNT = '0xC940c870A54ba91C3e2A8dD0D01D0bC96fC2672a';
const CTOKEN_BORROWED = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643'; // cDAI
const CTOKEN_COLLATERAL = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5'; // cETH
const UNISWAP_FACTORY = '0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f';
const BORROWING_ACCOUNT = '0xC940c870A54ba91C3e2A8dD0D01D0bC96fC2672a';

/**
LIQUIDATION CANDIDATE 0xC940c870A54ba91C3e2A8dD0D01D0bC96fC2672a RATIO 0.15736872769919819}
++ 0.0000000 REP / 0.0000000 ETH borrowed       0.0000000 REP / 0.0000000 ETH supplied
++ 0.0000000 USDC / 0.0000000 ETH borrowed      0.0000000 USDC / 0.0000000 ETH supplied
++ 0.0000000 ETH / 0.0000000 ETH borrowed       3.7151108 ETH / 3.7151108 ETH supplied
++ 7154.6897719 DAI / 16.2599396 ETH borrowed   0.0000000 DAI / 0.0000000 ETH supplied
++ 0.0000000 BAT / 0.0000000 ETH borrowed       0.0000000 BAT / 0.0000000 ETH supplied
++ 0.0001573 WBTC / 0.0042277 ETH borrowed      0.0000000 WBTC / 0.0000000 ETH supplied
++ 0.0000000 DSToken / 0.0000000 ETH borrowed   0.0000000 DSToken / 0.0000000 ETH supplied
++ 3229.3393480 USDT / 7.3435143 ETH borrowed   0.0000000 USDT / 0.0000000 ETH supplied
++ TOTAL 23.6076816 ETH borrowed 3.7151108 ETH supplied
 */

describe("Liquidator", async function() {
    before(async () => {
        await deployments.fixture('liquidator'); // tag
    });

    it("Should work", async function() {
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

        var repayBorrowAmount = ethers2.utils.parseUnits('10');

        let result = await liquidator.liquidate(
            BORROWING_ACCOUNT,
            CTOKEN_BORROWED,
            CTOKEN_COLLATERAL,
            repayBorrowAmount,
            UNISWAP_FACTORY,
        );

        let txDone = await result.wait();

        console.log(txDone);
    });

    after(async () => {
        // Give ganache some time to log the error
        await new Promise(resolve => setTimeout(resolve, 10000));
    });
});
