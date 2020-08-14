pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IUniswapV2PFactory.sol";
import "./IUniswapV2Pair.sol";
import "./IUniswapV2Callee.sol";
import "./ICToken.sol";
import "./MyERC20.sol";
import "./WETH9.sol";
import "./IComptroller.sol";

contract Liquidator is IUniswapV2Callee {
    address public ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public WETH_ADDRESS = 0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2;

    address public owner;

    struct Data {
        address cTokenBorrowed;
        address cTokenCollateral;
        address borrowAccount;
        uint repayBorrowAmount;
    }

    constructor() {
        owner = msg.sender;
    }

    function liquidate(
        address borrowAccount,
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 repayBorrowAmount,
        address uniswapFactory
    ) external returns (uint) {
        require(owner == msg.sender);

        require(cTokenBorrowed != cTokenCollateral, "same ctoken");

        require(ICToken(cTokenBorrowed).comptroller() == ICToken(cTokenCollateral).comptroller(), "diff comptroller");

        require(repayBorrowAmount > 0, "zero amt");

        // 1. Do flash swap for borrowed token
        address borrowedToken = ICToken(cTokenBorrowed).underlying();
        address collateralToken = ICToken(cTokenCollateral).underlying();

        // Use WETH to wrap ether for uniswap, which doesnt accept native ETH
        if (borrowedToken == ETH_ADDRESS) {
            borrowedToken = WETH_ADDRESS;
        }

        if (collateralToken == ETH_ADDRESS) {
            borrowedToken = WETH_ADDRESS;
        }

        address uniswapPair = IUniswapV2PFactory(uniswapFactory).getPair(borrowedToken, collateralToken);

        require(uniswapPair != 0);

        address pairToken0 = IUniswapV2Pair(uniswapPair).token0;
        address pairToken1 = IUniswapV2Pair(uniswapPair).token1;

        uint amount0Out = borrowedToken == pairToken0 ? repayBorrowAmount : 0;
        uint amount1Out = borrowedToken == pairToken1 ? repayBorrowAmount : 0;

        Data memory data = {
            cTokenBorrowed: cTokenBorrowed,
            cTokenCollateral: cTokenCollateral,
            borrowAccout: borrowAccount,
            repayBorrowAmount: repayBorrowAmount
        }

        uint startBalance = IERC20(borrowedToken).balanceOf(address(this));

        IUniswapV2Pair(uniswapPair).swap(amount0Out, amount1Out, IUniswapV2Callee(this), abi.encode(data));
        
        uint endBalance = IERC20(borrowedToken).balanceOf(address(this));

        return endBalance - startBalance;
    }

    function uniswapV2Call(
        address sender, 
        uint amount0, 
        uint amount1, 
        bytes memory _data
    ) public override {
        Data memory data = abi.decode(_data, (Data));

        // 2. Repay borrowed loan and receive collateral
        if (ICToken(cTokenBorrowed).underlying() == ETH_ADDRESS) {
            // We got WETH from uniswap, unwrap to ETH
            WETH9(WETH_ADDRESS).withdraw(data.repayBorrowAmount);

            // Do the liquidate, value() specifies the repay amount in ETH
            ICEther(data.cTokenBorrowed).liquidateBorrow.value(data.repayBorrowAmount)(data.borrowAccount, data.cTokenCollateral);
        } else {
            // Easy we already have the balance
            ICERC20(data.cTokenBorrowed).liquidateBorrow(data.borrowAccout, data.repayBorrowAmount, data.repayBorrowAmount);
        }

        // 3. Redeem collateral cToken for collateral
        uint collateralTokens = ICToken(data.cTokenCollateral).balanceOf(address(this));

        ICToken(data.cTokenCollateral).redeem(collateralTokens);

        if (ICToken(data.cTokenCollateral).underlying() == ETH_ADDRESS) {
            // Uniswap needs us to have a balance of WETH to trade out
            // We can just swap our whole balance to WETH here, since we withdraw by ERC20 in other cases
            WETH9(WETH_ADDRESS).deposit(address(this).balance);
        }

        // 4. Now the flash loan can go through because we have a balance of collateral token
        // to swap for our borrowed tokens
    }

    function withdraw(address token) {
        require(msg.sender == owner, "not owner");

        uint balance = IERC20(token).balanceOf(this);

        IERC20(token).transfer(msg.sender, balance);
    }

    function enterMarkets(address comptroller, address[] calldata cTokens) external returns (uint) {
        return IComptroller(comptroller).enterMarkets(cTokens);
    }

    function exitMarket(address comptroller, address cToken) external returns (uint) {
        return IComptroller(comptroller).exitMarket(cToken);
    }
}