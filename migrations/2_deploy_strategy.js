const StrategyV1 = artifacts.require("StrategyV1");

module.exports = function(deployer) {
  deployer.deploy(StrategyV1);
};
