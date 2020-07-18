module.exports = {
  etherscan: {
    apiKey: '53XIQJECGSXMH9JX5RE8RKC7SEK8A2XRGQ'
  },
  contracts_directory: './contracts/',
  contracts_build_directory: './build/',
  migrations_directory: './migrations/',
  networks: {
    development: {
     host: "127.0.0.1",     
     port: 8545,
     network_id: "1", // mainnet infura
     networkCheckTimeout: 400
    },
  },
  compilers: {
    solc: {
      version: '^0.6.0'
    }
  }
}
