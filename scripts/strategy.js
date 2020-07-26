const fs = require('fs');

const ethers = require("@nomiclabs/buidler").ethers;

const wallet = require('./wallet.js');

const STRATEGY_NAME = 'StrategyV1';
const ADDRESS_FILE_NAME = 'contracts.json';

function Strategy(contract) {
    this.contract = contract;
}

const getNetworkName = async () => {
    let network = await ethers.provider.getNetwork();

    return network.chainId;
}

const getAddress = async () => {
    let json = JSON.parse(fs.readFileSync(ADDRESS_FILE_NAME));

    let network = await getNetworkName();

    try {
        return json[network][STRATEGY_NAME];
    } catch (err) {
        return undefined;
    }
}

const setAddress = async (contractName, address) => {
    let json = JSON.parse(fs.readFileSync(ADDRESS_FILE_NAME));

    let network = await getNetworkName();

    if (!(network in json)) {
        json[network] = {}
    }

    json[network][contractName] = address;

    fs.writeFileSync(ADDRESS_FILE_NAME, JSON.stringify(json));
}

module.exports = {
    create: async () => {
        let contract;

        let address = await getAddress();

        if (address === undefined) {
            var factory = await ethers.getContractFactory(STRATEGY_NAME, wallet);

            contract = await factory.deploy();

            await contract,deployed();

            console.log(contract);

            await setAddress(STRATEGY_NAME, contract.address);
        } else {
            contract = await ethers.getContractAt(STRATEGY_NAME, address, wallet);
        }

        console.log(`Strategy deployed at ${contract.address}`);

        return new Strategy(contract);
    }
}