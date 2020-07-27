const fs = require('fs');
const axios = require('axios');
const ethers = require("@nomiclabs/buidler").ethers;

const wallet = require('./wallet.js');
const constants = require('./constants.js');

const coinMarketCapEndpoint = 'https://pro-api.coinmarketcap.com';
const coinMarketCapApiKey = '50615d1e-cf23-4931-a566-42f0123bd7b8';

const etherscanEndpoint = 'http://api.etherscan.io';
const etherscanApiKey = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';

// Token

function Token(contract, symbol, decimals, price) {
    this.contract = contract;
    this.symbol = symbol;
    this.decimals = decimals;
    this.price = price;
}

Token.prototype.toString = function() {
    return this.contract.address;
}

Token.prototype.formatAmount = function(amt) {
    return (amt / constants.TEN.pow(this.decimals)).toFixed(constants.DISPLAY_DECIMALS);
}

// TokenFactory

function TokenFactory() {
    this.tokens = {};
    this.prices = {};

    this.init = async function() {
        try {
            this.tokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8').toString());
        } catch(err) {
            console.log('Failed to load tokens config');
        }

        let response = await axios.get(`${coinMarketCapEndpoint}/v1/cryptocurrency/listings/latest`, {
            headers: {
                'X-CMC_PRO_API_KEY': coinMarketCapApiKey
            }
        });

        let data = response.data.data;

        for (let coin of data) {
            this.prices[coin.symbol] = coin.quote.USD.price;
        }
    }

    this.getTokenByAddress = async function(address) {
        if (address in this.tokens) {
            return this.tokens[address];
        }

        // TODO, this isnt a great way to deal with kyber's ETH address
        var contract = {address: constants.ETH_ADDRESS};
        var symbol = 'ETH';
        var decimals = ethers.BigNumber.from(18);

        if (address != constants.ETH_ADDRESS) {
            contract = await ethers.getContractAt('MyERC20', address, wallet);
            decimals = await contract.decimals();
            symbol = '';

            try {
                symbol = await contract.symbol();
            } catch (err) {
                console.log(`Failed to fetch symbol from contract for ${address}, falling back to etherscan`);

                let url = `${etherscanEndpoint}/api?module=contract&action=getsourcecode&address=${address}&apikey=${etherscanApiKey}`;
                
                let response = await axios.get(url);

                if (response.data.status != '0') {
                    symbol = response.data.result[0].ContractName;
                }
            }

            if (symbol == '') {
                symbol = address;
            }
        }

        var price = symbol in this.prices ? this.prices[symbol] : 0;

        var token = new Token(contract, symbol, decimals, price);

        this.tokens[address] = token;

        return token;
    }

    this.getTokenBySymbol = function(symbol) {
        for (const [address, token] of Object.entries(this.tokens)) {
            if (token.symbol == symbol) {
                return token;
            }
        }
    }
}

module.exports = {
    TokenFactory: new TokenFactory()
};