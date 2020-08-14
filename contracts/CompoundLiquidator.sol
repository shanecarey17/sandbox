pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./IUniswapV2Factory.sol";
import "./IUniswapV2Pair.sol";
import "./IUniswapV2Callee.sol";
import "./ICToken.sol";
import "./MyERC20.sol";
import "./WETH9.sol";
import "./IComptroller.sol";
import "./Utils.sol";

contract CompoundLiquidator is IUniswapV2Callee {
    address constant public ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address constant public WETH_ADDRESS = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant public CETH_ADDRESS = 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5;

    address public owner;

    struct Data {
        address cTokenBorrowed;
        address cTokenCollateral;
        address borrowAccount;
        uint repayBorrowAmount;
    }

    constructor() public {
        owner = msg.sender;
    }

    // Required to receive ether
    fallback() external payable {}
    receive() external payable {}

    function liquidate(
        address borrowAccount,
        address cTokenBorrowed,
        address cTokenCollateral,
        uint256 repayBorrowAmount,
        address uniswapFactory
    ) external returns (uint) {
        require(owner == msg.sender, "not owner");

        require(cTokenBorrowed != cTokenCollateral, "same ctoken");

        require(ICToken(cTokenBorrowed).comptroller() == ICToken(cTokenCollateral).comptroller(), "diff comptroller");

        require(repayBorrowAmount > 0, "zero amt");

        // 1. Do flash swap for borrowed token

        // cEther has no underlying() method smh, have to use WETH with uniswap
        address borrowedToken;
        address collateralToken;

        if (cTokenBorrowed == CETH_ADDRESS) {
            borrowedToken = WETH_ADDRESS;
        } else {
            borrowedToken = ICToken(cTokenBorrowed).underlying();
        }

        if (cTokenCollateral == CETH_ADDRESS) {
            collateralToken = WETH_ADDRESS;
        } else {
            collateralToken = ICToken(cTokenCollateral).underlying();
        }

        address uniswapPair = IUniswapV2Factory(uniswapFactory).getPair(borrowedToken, collateralToken);

        require(uniswapPair != address(0), "no pair");

        address pairToken0 = IUniswapV2Pair(uniswapPair).token0();
        address pairToken1 = IUniswapV2Pair(uniswapPair).token1();

        uint amount0Out = borrowedToken == pairToken0 ? repayBorrowAmount : 0;
        uint amount1Out = borrowedToken == pairToken1 ? repayBorrowAmount : 0;

        Data memory data = Data({
            cTokenBorrowed: cTokenBorrowed,
            cTokenCollateral: cTokenCollateral,
            borrowAccount: borrowAccount,
            repayBorrowAmount: repayBorrowAmount
        });

        uint startBalance = MyERC20(borrowedToken).balanceOf(address(this));

        IUniswapV2Pair(uniswapPair).swap(amount0Out, amount1Out, address(this), abi.encode(data));
        
        uint endBalance = MyERC20(borrowedToken).balanceOf(address(this));

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
        if (data.cTokenBorrowed == CETH_ADDRESS) {
            // We got WETH from uniswap, unwrap to ETH
            WETH9(WETH_ADDRESS).withdraw(data.repayBorrowAmount);

            // Do the liquidate, value() specifies the repay amount in ETH
            ICEther(data.cTokenBorrowed).liquidateBorrow.value(data.repayBorrowAmount)(data.borrowAccount, data.cTokenCollateral);
        } else {
            require(MyERC20(ICToken(data.cTokenBorrowed).underlying()).balanceOf(address(this)) == data.repayBorrowAmount, "bad swap");
            // Easy we already have the balance
            uint res = ICERC20(data.cTokenBorrowed).liquidateBorrow(data.borrowAccount, data.repayBorrowAmount, data.cTokenCollateral);

            require(res == 0, Utils.concat('liquidate fail erc20 - errc ', Utils.uint2str(res)));
        }


        // 3. Redeem collateral cToken for collateral
        uint collateralTokens = ICToken(data.cTokenCollateral).balanceOf(address(this));

        ICToken(data.cTokenCollateral).redeem(collateralTokens);

        if (data.cTokenCollateral == CETH_ADDRESS) {
            // Uniswap needs us to have a balance of WETH to trade out
            // We can just swap our whole balance to WETH here, since we withdraw by ERC20 in other cases
            WETH9(WETH_ADDRESS).deposit.value(address(this).balance)();
        }

        // 4. Now the flash loan can go through because we have a balance of collateral token
        // to swap for our borrowed tokens
    }

    function withdraw(address token) external {
        require(msg.sender == owner, "not owner");

        uint balance = MyERC20(token).balanceOf(address(this));

        MyERC20(token).transfer(msg.sender, balance);
    }

    function enterMarkets(address comptroller, address[] calldata cTokens) external returns (uint[] memory) {
        return IComptroller(comptroller).enterMarkets(cTokens);
    }

    function exitMarket(address comptroller, address cToken) external returns (uint) {
        return IComptroller(comptroller).exitMarket(cToken);
    }
}