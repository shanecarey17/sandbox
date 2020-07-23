const legos = require('@studydefi/money-legos').legos;

const fs = require('fs');
const mnemonic = fs.readFileSync('.secret', 'utf8').toString().trim();

const wallet = ethers.Wallet.fromMnemonic(mnemonic).connect(ethers.provider);

const main = async () => {
    const uniswapFactory = await ethers.getContractAt('IUniswapFactory', legos.uniswap.factory.address, wallet);

    var tokens = [legos.erc20.dai.address, legos.erc20.weth.address, legos.erc20.usdc.address];

    var exchanges = [];

    for (var i = 0; i < tokens.length; i++) {
        let token = tokens[i]; // let is important

        var exchangeAddress = await uniswapFactory.getExchange(token);

        var exchangeContract = await ethers.getContractAt('IUniswapExchange', exchangeAddress, wallet);

        exchangeContract.on('TokenPurchase', function(buyer, eth_sold, tokens_bought) {
            console.log(`TokenPurchase ${token} ${buyer} ${eth_sold} ${tokens_bought}`);
        });

        exchangeContract.on('EthPurchase', function(buyer, tokens_sold, eth_bought) {
            console.log(`EthPurchase ${token} ${buyer} ${tokens_sold} ${eth_bought}`);
        });

        exchangeContract.on('AddLiquidity', function(provider, eth_amount, token_amount) {
            console.log(`AddLiquidity ${token} ${provider} ${eth_amount} ${token_amount}`);
        });

        exchangeContract.on('RemoveLiquidity', function(provider, eth_amount, token_amount) {
            console.log(`RemoveLiquidity ${token} ${provider} ${eth_amount} ${token_amount}`);
        });

        exchangeContract.on('Transfer', function(_from, _to, _value) {
            console.log(`Transfer ${token} ${_from} ${_to} ${_value}`);
        });

        exchangeContract.on('Approval', function(_owner, _spender, _value) {
            console.log(`Approval ${token} ${_owner} ${_spender} ${_value}`);
        });

        exchanges.push(exchangeContract);
    }
}

main();