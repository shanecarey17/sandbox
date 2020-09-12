const { deployments, ethers } = require("@nomiclabs/buidler");

const axios = require('axios');
const ethers2 = require('ethers'); // Nomic include defines important methods but doesnt have BigNumber

const COMPTROLLER_ADDRESS = '0x3d9819210a31b4961b30ef54be2aed79b9c9cd3b';

const CDAI = '0x5d3a536E4D6DbD6114cc1Ead35777bAB948E3643';
const CETH = '0x4ddc2d193948926d02f9b1fe9e1daa0718270ed5';
const CUSDC = '0x39aa39c021dfbae8fac545936693ac917d5e7563';
const CZRX = "0xB3319f5D18Bc0D84dD1b4825Dcde5d5f7266d407";

describe("LiquidatorWrapper", async () => {
	let liquidatorContract;
	let liquidatorWrapperContract;

	let ownerAccount;
	let ownerAccountAddress;

	before(async () => {
		let signers = await ethers.getSigners();
		ownerAccount = signers[0];
		ownerAccountAddress = await ownerAccount.getAddress();

		// Deploy liquidator
		await deployments.fixture('liquidator wrapper'); // tag
		const liqDeployment = await deployments.get("CompoundLiquidator");
		liquidatorContract = await ethers.getContractAt("CompoundLiquidator", liqDeployment.address);
		const liqWrapperDeployment = await deployments.get("CompoundLiquidatorWrapper");
		liquidatorWrapperContract = await ethers.getContractAt("CompoundLiquidatorWrapper", liqWrapperDeployment.address);
	});

	it.only('test post price & zap', async () => {
		const symbols = ['BTC', 'ETH', 'DAI', 'REP', 'ZRX', 'BAT', 'KNC', 'LINK', 'COMP'];
		let response = await axios.get('https://prices.compound.finance');
		let {coinbase, okex} = response.data;
		await liquidatorContract.enterMarkets(COMPTROLLER_ADDRESS, [CDAI, CETH]);
		let result = await liquidatorWrapperContract.liquidate(
			"0x3596c017ad351628Cd31980837c0938ddBaD7E49",
			CDAI,
			CETH,
			"100000000000000000",
			coinbase.messages,
			coinbase.signatures,
			symbols,
			{
				gasLimit: 5	 * 10**6, // estimate gas on ganache has bug
			}
		);
	});
});