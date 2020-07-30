const { deployments } = require("@nomiclabs/buidler");

const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;

const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const TEN = ethers2.BigNumber.from(10);

// https://etherscan.io/address/0x6b175474e89094c44da98b954eedeac495271d0f
const DAI_WHALE = "0x9eB7f2591ED42dEe9315b6e2AAF21bA85EA69F8C";

describe("Strategy", async function() {
    // Deploy strategy
    before(async () => {
        await deployments.fixture();
    });

    let doTrade = async (tokens) => {

    }

    it("Should trade", async function() {
        const strategyDeployment = await deployments.get("StrategyV1");
        const strategy = await ethers.getContractAt("StrategyV1", strategyDeployment.address);

        // Get contracts
        const soloMargin = await ethers.getContractAt('ISoloMargin', legos.dydx.soloMargin.address);
        const kyberNetworkProxy = await ethers.getContractAt('IKyberNetworkProxy', legos.kyber.network.address);
        const dai = await ethers.getContractAt('ERC20', legos.erc20.dai.address);
        const wbtc = await ethers.getContractAt('ERC20', legos.erc20.wbtc.address);
        const weth = await ethers.getContractAt('ERC20', legos.erc20.weth.address);
        const eth = {
            decimals: async () => { return ethers.BigNumber.from(18); },
            address: "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE",
            balanceOf: async (addr) => { return await ethers.provider.getBalance(addr); }
        }

        // Fund the strategy and margin, the strategy needs 
        // to maintain a balance to pay back margin
        const signers = await ethers.getSigners();
        const signer = signers[0];

        const signerBalance = await signer.getBalance();
        console.log(`Signer balance: ${signerBalance}`);

        var tradeAmount = ethers2.utils.parseUnits('10');

        // Try sending strat some eth
        await signer.sendTransaction({
            to: strategy.address,
            value: tradeAmount
        });

        let ethBalance = await eth.balanceOf(strategy.address);

        // Fund the strategy in DAI
        const daiWhale = await ethers.provider.getSigner(DAI_WHALE);
        await dai.connect(daiWhale).transfer(strategy.address, tradeAmount);

        // Calculate trade outcome
        const initialAmount = tradeAmount;

        let tokens = [eth, wbtc, dai];
        //let tokens = [dai, wbtc, eth]; // Works

        const initialBalance = await tokens[0].balanceOf(strategy.address);
        console.log(`Strategy ${strategy.address} initial balance: ${initialBalance}`);

        // TODO, DAI generally has enough in it but check here and fund if necessary
        const soloMarginBalance = await tokens[0].balanceOf(soloMargin.address);
        console.log(`SoloMargin ${soloMargin.address} initial balance: ${soloMarginBalance}`);

        
        // Calculate the rates up front for sanity checking (slow)
        // for (var i = 0; i < tokens.length; i++) {
        //     let idx0 = i;
        //     let idx1 = (i + 1) % tokens.length;

        //     var token0 = tokens[idx0];
        //     var token1 = tokens[idx1];

        //     let decimals0 = await token0.decimals();
        //     let decimals1 = await token1.decimals();

        //     let exchRate = await kyberNetworkProxy.getExpectedRate(token0.address, token1.address, tradeAmount);
        //     exchRate = exchRate.expectedRate;

        //     let lastTradeAmount = tradeAmount;

        //     if (decimals1.gte(decimals0)) {
        //         tradeAmount = tradeAmount.mul(exchRate).mul(TEN.pow(decimals1 - decimals0)).div(TEN.pow(18));
        //     } else {
        //         tradeAmount = tradeAmount.mul(exchRate).div(TEN.pow(decimals0 - decimals1 + 18));
        //     }

        //     console.log(`${lastTradeAmount.toString()} [${idx0}] => ${tradeAmount.toString()} [${idx1}] @${exchRate}`);
        // }

        // const finalAmount = tradeAmount;

        // const expectedProfit = finalAmount - initialAmount;

        // console.log(`Expected profit: ${expectedProfit}`);


        // Do the trade
        let tx = await strategy.initiateFlashLoan(
            soloMargin.address,
            kyberNetworkProxy.address,
            tokens[0].address,
            tokens[1].address,
            tokens[2].address,
            initialAmount,
            {
                gasLimit: 6000000
            }
        );

        console.log(tx);

        let txDone = await tx.wait(); // TODO check the log

        // Check balances match expected
        let finalBalance = await tokens[0].balanceOf(strategy.address);

        const actualProfit = finalBalance - initialBalance;

        console.log(`Actual Profit: ${actualProfit}`);

        // Transfer to owner account
        let tx1 = await strategy.withdraw(tokens[0].address, finalBalance);

        let ownerBalance = await tokens[0].balanceOf(await signer.getAddress());

        expect(ownerBalance.sub(signerBalance)).to.equal(finalBalance);
    });

    after(async () => {
        // Give ganache some time to log the error
        await new Promise(resolve => setTimeout(resolve, 3000));
    });
});
