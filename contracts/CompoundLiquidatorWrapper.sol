pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./CompoundLiquidator.sol";

interface IUniswapAnchoredView {
    function postPrices(bytes[] calldata messages, bytes[] calldata signatures, string[] calldata symbols) external;
}

interface ICompoundLiquidator {
    function liquidate(address borrowAccount, address cTokenBorrowed, address cTokenCollateral, uint256 repayBorrowAmount) external returns (uint);
}

contract CompoundLiquidatorWrapper {
    address constant public UNISWAP_ANCHORED_VIEW = 0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE;

    address public liquidator;
    
    constructor(address liquidator_) public {
        liquidator = liquidator_;
    }

    function liquidate(
        // liquidator args
        address borrowAccount,
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 repayBorrowAmount,
        // oracle args
        bytes[] calldata messages, 
        bytes[] calldata signatures, 
        string[] calldata symbols
    ) external returns (uint) {
        // Do this check here so we dont fail a tx in the oracle contract (sus!), oracle does the same check
        require(messages.length == signatures.length, "messages and signatures must be 1:1");

        // post the prices to the oracle
        IUniswapAnchoredView(UNISWAP_ANCHORED_VIEW).postPrices(messages, signatures, symbols);

        // do the liquidation with the new prices
        return ICompoundLiquidator(liquidator).liquidate(borrowAccount, cTokenBorrowed, cTokenCollateral, repayBorrowAmount);
    }
}
