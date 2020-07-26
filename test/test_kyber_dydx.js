const expect = require("chai").expect;
const legos = require('@studydefi/money-legos').legos;

describe("Strategy", function() {
  it("Should work", async function() {
    // const Greeter = await ethers.getContractFactory("Greeter");
    // const greeter = await Greeter.deploy("Hello, world!");
    
    // await greeter.deployed();
    // expect(await greeter.greet()).to.equal("Hello, world!");

    // await greeter.setGreeting("Hola, mundo!");
    // expect(await greeter.greet()).to.equal("Hola, mundo!");

    const signers = await ethers.getSigners();

    const strategyFactory = await ethers.getContractFactory('StrategyV1');
    const strategy = await strategyFactory.deploy();
    await strategy.deployed();

    const soloMargin = await ethers.getContractAt('ISoloMargin', legos.dydx.soloMargin.address);
    const kyberNetworkProxy = await ethers.getContractAt('IKyberNetworkProxy', legos.kyber.network.address);
    const tokenA = await ethers.getContractAt('IERC20', legos.erc20.dai.address);
    const tokenB = await ethers.getContractAt('IERC20', legos.erc20.weth.address);
    const tokenC = await ethers.getContractAt('IERC20', legos.erc20.usdc.address);

    const initialBalance = await tokenA.balanceOf(strategy.address);

    console.log(`Strategy deployed at ${strategy.address} - ${initialBalance}`);

    let tx = await strategy.initiateFlashLoan(
        soloMargin.address,
        kyberNetworkProxy.address,
        tokenA.address,
        tokenB.address,
        tokenC.address,
        1000000,
        {
            gasLimit: 5000000
        }
    );

    console.log(tx);

    let finalBalance = await tokenA.balanceOf(strategy.address);

    expect(finalBalance).to.gt(initialBalance);
  });
});