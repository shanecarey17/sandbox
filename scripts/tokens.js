const fs = require('fs');
const assert = require('assert');
const axios = require('axios');
const ethers = require("@nomiclabs/buidler").ethers;
const readline = require('readline');

const constants = require('./constants.js');

const coinMarketCapEndpoint = 'https://pro-api.coinmarketcap.com';
const coinMarketCapApiKey = '50615d1e-cf23-4931-a566-42f0123bd7b8';

const etherscanEndpoint = 'http://api.etherscan.io';
const etherscanApiKey = '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ';

// Token

function Token(contract, symbol, decimals, price) {
    this.address = contract.address;
    this.contract = contract;
    this.symbol = symbol;
    this.decimals = decimals;
    this.price = price;
    this.ethRate = 0;

    this.toString = () => {
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

    this.parseAmount = (amt) => {
        return ethers.BigNumber.from(String(BigInt(Math.floor(parseFloat(amt) * 10**this.decimals))));
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
        }
    }

    this.loadToken = async (address) => {
        let cached = this.getTokenByAddress(address);

        if (cached !== undefined) {
            return cached;
        }

        // TODO, this isnt a great way to deal with kyber's ETH address
        var contract = {address: constants.ETH_ADDRESS};
        var symbol = 'ETH';
        var decimals = ethers.BigNumber.from(18);

        if (address != constants.ETH_ADDRESS) {
            contract = await ethers.getContractAt('MyERC20', address);
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
        }

        var token = new Token(contract, symbol, decimals, price);

        this.tokens[address] = token;

        return token;
    }

    let loadConfig = async () => {
        let rl = readline.createInterface({
            input: fs.createReadStream(constants.TOKENS_FILENAME),
            crlfDelay: Infinity
        });

        let addresses = {};
        let tasks = [];

        for await (const line of rl) {
            if (line.length == 0) {
                continue;
            }
            
            if (line.startsWith('#')) {
                continue;
            }

            let data = line.trim();
            let [symbol, address] = data.split(',');

            assert(symbol !== undefined);
            assert(address !== undefined);

            if (address in addresses) {
                continue;
            }

            addresses[address] = true;

            tasks.push((async (address) => {
                let token = await this.loadToken(address);

                console.log(`Loaded token from config ${token.symbol} ${token.contract.address}`);
            })(address));
        }

        await Promise.all(tasks);
    }

    this.init = async () => {
        await loadPrices();

        await loadConfig();

        console.log('TOKENS INITIALIZED');
    }

    this.getTokenByAddress = (address) => {
        if (address in this.tokens) {
            return this.tokens[address];
        }
    }

    this.getEthToken = () => {
        return this.tokens[constants.ETH_ADDRESS];
    }

    this.allTokens = () => {
        return Promise.all(Object.values(this.tokens));
    }
}

var factory = new TokenFactory();

module.exports = {
    TokenFactory: factory,
};
