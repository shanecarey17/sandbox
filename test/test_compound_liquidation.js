const { deployments } = require("@nomiclabs/buidler");

const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;

const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const LIQUIDATE_ACCOUNT = '';

describe("Liquidator", async function() {
    // Deploy strategy
    before(async () => {
        await deployments.fixture();
    });

    it("Should work", async function() {
        const liqDeployment = await deployments.get("CompoundLiquidator");
        const liquidator = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);

        await liquidator.enterMarkets(COMPTROLLER_ADDRESS, [/* TODO */]);

        var repayAmount = ethers2.utils.parseUnits('10');

        let result = await liquidator.liquidate(
            BORROWING_ACCOUNT,
            CTOKEN_BORROWED,
            CTOKEN_COLLATERAL,
            repayAmount,
            UNISWAP_FACTORY,
        );

        let txDone = await result.wait();

        console.log(txDone);
    });

    after(async () => {
        // Give ganache some time to log the error
        await new Promise(resolve => setTimeout(resolve, 3000));
    });
});
