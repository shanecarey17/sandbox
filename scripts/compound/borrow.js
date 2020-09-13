const ethers = require("@nomiclabs/buidler").ethers;
const fs = require('fs');

const tokens = require('./../tokens.js');
const wallet = require('./../wallet.js');

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';
const COMPTROLLER_ABI = JSON.parse(fs.readFileSync('abi/compound/comptroller.json'));

const DAI_CTOKEN_ADDRESS = '0x5d3a536e4d6dbd6114cc1ead35777bab948e3643';

const CTOKEN_ABI = JSON.parse(fs.readFileSync('abi/compound/ctoken.json'));

const ETHER_PRICE = 440.0;

const run = async () => {
    await tokens.TokenFactory.init();

    let walletAddress = await wallet.getAddress();

    let walletEthBalance = await wallet.getBalance();

    console.log(`WALLET BALANCE ${ethers.utils.formatUnits(walletEthBalance)}`);

    let comptrollerContract = new ethers.Contract(COMPTROLLER_ADDRESS, COMPTROLLER_ABI, wallet);

    await comptrollerContract.deployed();

    let accountLiquidity = await comptrollerContract.getAccountLiquidity(walletAddress);

    console.log(`ACCOUNT LIQUIDITY ${accountLiquidity}`);

    let cTokenContract = new ethers.Contract(DAI_CTOKEN_ADDRESS, CTOKEN_ABI, wallet);

    await cTokenContract.deployed();

    let token = tokens.TokenFactory.getTokenByAddress(await cTokenContract.underlying());

    let tokenBalance = await token.balanceOf(walletAddress);

    console.log(`START BALANCE ${ethers.utils.formatUnits(tokenBalance)} ${token.symbol}`);

    let enteredMarket = await comptrollerContract.checkMembership(walletAddress, DAI_CTOKEN_ADDRESS);

    if (!enteredMarket) {
        console.log(`Entering market ${DAI_CTOKEN_ADDRESS}, will not need to happen on next run`);

        await comptrollerContract.enterMarkets([DAI_CTOKEN_ADDRESS]);

        return;
    }

    let cTokenContractBalance = await cTokenContract.getCash();

    console.log(`CTOKEN BALANCE ${cTokenContractBalance}`);

    let borrowAmount = ethers.utils.parseEther('10000');

    let gasResult = await cTokenContract.estimateGas.borrow(borrowAmount);

    let gasPrice = ethers.utils.formatUnits(gasResult);

    console.log(`GAS PRICE ${gasPrice} ETH`);
    console.log(`GAS PRICE $${gasPrice * ETHER_PRICE}`);

    let staticResult = await cTokenContract.callStatic.borrow(borrowAmount);

    console.log(staticResult);

    // let realResult = await cTokenContract.borrow(ethers.utils.parseEther);

    // let txDone = await realResult.wait();

    // console.log(txDone);
    console.log('DONE');

    let newTokenBalance = await token.balanceOf(walletAddress);

    console.log(`NEW BALANCE ${ethers.utils.formatUnits(newTokenBalance)} ${token.symbol}`);
} 

function main() {
    try {
        run();
    } catch (e) {
        throw e;
    }
}

main();