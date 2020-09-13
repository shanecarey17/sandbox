const fs = require('fs');

const bre = require("@nomiclabs/buidler");
const ethers = bre.ethers;

const run = async (keyfile) => {
    if (fs.existsSync(keyfile)) {
        throw new Error('keyfile exists');
    }

    let newWallet = ethers.Wallet.createRandom();

    console.log(`WALLET CREATED`);
    console.log(`ADDRESS: ${await newWallet.getAddress()}`);
    console.log(`PUBLIC KEY: ${newWallet.publicKey}`);
    console.log(`PRIVATE KEY: ${newWallet.privateKey}`);

    fs.writeFileSync(keyfile, newWallet.privateKey);
}

module.exports = run;

