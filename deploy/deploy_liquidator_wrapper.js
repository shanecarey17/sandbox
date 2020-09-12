module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
	const { deploy } = deployments;
	const { deployer } = await getNamedAccounts();
	const liqDeployment = await deployments.get("CompoundLiquidator");
	const uniswapViewAddress = "0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE";

	const deployResult = await deploy("CompoundLiquidatorWrapper", {
		from: deployer,
		gas: 100000,
		args: [uniswapViewAddress, liqDeployment.address]
	});

	const liquidatorContract = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);
	await liquidatorContract.whitelistCaller(deployResult.address);

	const chainId = await getChainId();

	if (deployResult.newlyDeployed) {
		console.log(`LIQUIDATOR WRAPPER DEPLOYED (${chainId}) @ ${deployResult.address}`);
	}
};

module.exports.tags = ['liquidator wrapper'];
// needed to add this so liquidator fixture executed first in test
module.exports.dependencies = ["liquidator"];