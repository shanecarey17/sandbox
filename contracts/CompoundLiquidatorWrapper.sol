pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

interface IUniswapAnchoredView {
    function postPrices(bytes[] calldata messages, bytes[] calldata signatures, string[] calldata symbols) external;
}

interface ICompoundLiquidator {
    function liquidate(address borrowAccount, address cTokenBorrowed, address cTokenCollateral, uint256 repayBorrowAmount) external returns (uint);
}

contract CompoundLiquidatorWrapper {
    //address constant public UNISWAP_ANCHORED_VIEW = 0x9B8Eb8b3d6e2e0Db36F41455185FEF7049a35CaE;

    address public owner;
    address public uniswapAnchoredView;
    address public liquidator;
    
    constructor(address view_, address liquidator_) public {
        owner = msg.sender;
        uniswapAnchoredView = view_;
        liquidator = liquidator_;
    }

    function setLiquidator(address liquidator_) external {
        require(msg.sender == owner, "not owner");
        liquidator = liquidator_;
    }

    function setView(address view_) external {
        require(msg.sender == owner, "not owner");
        uniswapAnchoredView = view_;
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
        IUniswapAnchoredView(uniswapAnchoredView).postPrices(messages, signatures, symbols);

        // do the liquidation with the new prices
        return ICompoundLiquidator(liquidator).liquidate(borrowAccount, cTokenBorrowed, cTokenCollateral, repayBorrowAmount);
    }
}
