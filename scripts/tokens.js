const fs = require('fs');
const assert = require('assert');
const axios = require('axios');
const ethers = require("@nomiclabs/buidler").ethers;
const readline = require('readline');

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

    thistoString = () => {
        return this.contract.address;
    }

    this.formatAmount = (amt) => {
        return (amt / constants.TEN.pow(this.decimals)).toFixed(constants.DISPLAY_DECIMALS);
    }

    this.balanceOf = async (address) => {
        if (this.contract.address === constants.ETH_ADDRESS) {
            return await ethers.provider.getBalance(address);
        }

        return await this.contract.balanceOf(address);
    }
}

// TokenFactory

function TokenFactory() {
    this.tokens = {};
    this.prices = {};

    let loadPrices = async () => {
        // Load prices first, tokens dont fetch them dynamically
        let response = await axios.get(`${coinMarketCapEndpoint}/v1/cryptocurrency/listings/latest`, {
            headers: {
                'X-CMC_PRO_API_KEY': coinMarketCapApiKey
            }
        });

        let data = response.data.data;

        for (let coin of data) {
            let price = coin.quote.USD.price;
            this.prices[coin.symbol] = price;
            console.log(`PRICE $${price} for ${coin.symbol}`);
        }
    }

    let loadConfig = async () => {
        let configTasks = [];

        // The load tokens from config, if present
        try {
            let rl = readline.createInterface({
                input: fs.createReadStream(constants.TOKENS_FILENAME),
            })

            rl.on('line', (line) => {
                let address = line.trim();

                if (address in this.tokens) {
                    return;
                }

                let task = this.getTokenByAddress(address).then((token) => {
                    console.log(`Loaded token from config ${token.symbol} ${token.contract.address}`);
                });

                configTasks.push(task);
            });
        } catch(err) {
            console.log(constants.CONSOLE_RED, `Could not load tokens from config ${constants.TOKENS_FILENAME}`);
            console.log(err);
        }

        await Promise.all(configTasks);
    }

    this.init = async () => {
        await loadPrices();

        await loadConfig();
    }

    let appendTokenToFile = (address) => {
        fs.appendFileSync(constants.TOKENS_FILENAME, address.trim() + '\n');
    }

    let loadToken = async (address) => {
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

        var price = 0;

        if (symbol in this.prices) {
            price = this.prices[symbol];
        } else {
            console.log(constants.CONSOLE_RED, `PRICE NOT AVAILABLE FOR ${symbol}`);
        }

        var token = new Token(contract, symbol, decimals, price);

        this.tokens[address] = token;

        appendTokenToFile(address);

        return token;
    }

    this.getTokenByAddress = (address) => {
        if (address in this.tokens) {
            return Promise.resolve(this.tokens[address]);
        }

        if (!(address.startsWith('0x'))) {
            throw new Error(`INVALID TOKEN ADDRESS ${address}`);
        }

        let px = loadToken(address);

        this.tokens[address] = px;

        return px;
    }

    this.getTokenBySymbol = (symbol) => {
        for (const [address, token] of Object.entries(this.tokens)) {
            if (token.symbol == symbol) {
                return token;
            }
        }
    }

    this.allTokens = () => {
        return Promise.all(Object.values(this.tokens));
    }
}

module.exports = {
    TokenFactory: new TokenFactory()
};