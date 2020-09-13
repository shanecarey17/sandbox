module.exports = async ({ getNamedAccounts, deployments, getChainId }) => {
    const { deploy } = deployments;
    const { deployer } = await getNamedAccounts();

    const deployResult = await deploy("CompoundLiquidator", {
        from: deployer,
        gas: 100000,
        args: []
    });

    const chainId = await getChainId();

    if (deployResult.newlyDeployed) {
        console.log(`LIQUIDATOR DEPLOYED (${chainId}) @ ${deployResult.address}`);
    }
};

module.exports.tags = ['liquidator'];