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
    address constant public WETH_ADDRESS = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant public CETH_ADDRESS = 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5;
    address constant public UNISWAP_FACTORY_ADDRESS = 0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f;

    address public owner;

    struct Data {
        address cTokenBorrowed;
        address cTokenCollateral;
        address borrowAccount;
        uint repayBorrowAmount;
        address uniswapPair;
        uint swapCollateralAmount;
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
        uint256 repayBorrowAmount
    ) external returns (uint) {
        require(owner == msg.sender, "not owner");
        require(cTokenBorrowed != cTokenCollateral, "cTokenBorrowed and cTokenCollateral are the same");
        require(ICToken(cTokenBorrowed).comptroller() == ICToken(cTokenCollateral).comptroller(), "cTokens have different comptrollers");
        require(repayBorrowAmount > 0, "zero repayBorrowAmount");

        (address borrowedToken, address collateralToken) = getUnderlyings(cTokenBorrowed, cTokenCollateral);
        address uniswapPair = IUniswapV2Factory(UNISWAP_FACTORY_ADDRESS).getPair(borrowedToken, collateralToken);
        require(uniswapPair != address(0), "uniswap pair doesn't exist");

        uint pairBorrowedAvailable = MyERC20(borrowedToken).balanceOf(uniswapPair);
        if (pairBorrowedAvailable < repayBorrowAmount) {
            repayBorrowAmount = pairBorrowedAvailable;
        }

        (uint amount0Out, uint amount1Out, uint swapCollateralAmount) = getAmounts(uniswapPair, borrowedToken, repayBorrowAmount);

        Data memory data = Data({
            cTokenBorrowed: cTokenBorrowed,
            cTokenCollateral: cTokenCollateral,
            borrowAccount: borrowAccount,
            repayBorrowAmount: repayBorrowAmount,
            uniswapPair: uniswapPair,
            swapCollateralAmount: swapCollateralAmount
        });

        uint startBalance = MyERC20(collateralToken).balanceOf(address(this));

        // 1. Initiate flash loan (either amount0Out or amount1Out will be zero)
        IUniswapV2Pair(uniswapPair).swap(amount0Out, amount1Out, address(this), abi.encode(data));
        uint endBalance = MyERC20(collateralToken).balanceOf(address(this));

        if (endBalance < startBalance) {
            require(false, "end balance less than start balance");
        }
    }

    function getUnderlyings(address cTokenBorrowed, address cTokenCollateral) internal 
    returns (address borrowedToken, address collateralToken) {
        // cEther has no underlying() method smh, have to use WETH with uniswap
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
    }

    function getAmounts(address uniswapPair, address tokenOut, uint amountOut) internal 
    returns (uint amount0Out, uint amount1Out, uint amountIn) {
        address pairToken0 = IUniswapV2Pair(uniswapPair).token0();
        address pairToken1 = IUniswapV2Pair(uniswapPair).token1();
        // amount out
        amount0Out = tokenOut == pairToken0 ? amountOut : 0;
        amount1Out = tokenOut == pairToken1 ? amountOut : 0;
        // amount in
        (uint reserve0, uint reserve1, uint blockTs) = IUniswapV2Pair(uniswapPair).getReserves();
        uint reserveOut = tokenOut == pairToken0 ? reserve0 : reserve1;
        uint reserveIn = tokenOut == pairToken0 ? reserve1 : reserve0;
        amountIn = getAmountIn(amountOut, reserveIn, reserveOut);
    }

    // Stolen from uniswap v2 library
    function getAmountIn(uint amountOut, uint reserveIn, uint reserveOut) internal pure returns (uint amountIn) {
        uint numerator = reserveIn * amountOut * 1000;
        uint denominator = (reserveOut - amountOut) * 997;
        amountIn = (numerator / denominator) + 1;
    }

    function uniswapV2Call(
        address sender, 
        uint amount0, 
        uint amount1, 
        bytes memory _data
    ) public override {
        Data memory data = abi.decode(_data, (Data));
        require(address(this) == sender, "sender needs to be liquidator");

        // 2. Repay borrowed loan and receive collateral
        if (data.cTokenBorrowed == CETH_ADDRESS) {
            // We got WETH from uniswap, unwrap to ETH
            WETH9(WETH_ADDRESS).withdraw(data.repayBorrowAmount);

            // Do the liquidate, value() specifies the repay amount in ETH
            ICEther(data.cTokenBorrowed).liquidateBorrow.value(data.repayBorrowAmount)(data.borrowAccount, data.cTokenCollateral);
        } else {
            require(MyERC20(ICToken(data.cTokenBorrowed).underlying()).balanceOf(address(this)) >= data.repayBorrowAmount, "bad swap");
            // Easy we already have the balance
            MyERC20(ICToken(data.cTokenBorrowed).underlying()).approve(data.cTokenBorrowed, data.repayBorrowAmount);

            uint res = ICERC20(data.cTokenBorrowed).liquidateBorrow(data.borrowAccount, data.repayBorrowAmount, data.cTokenCollateral);

            require(res == 0, Utils.concat('liquidate fail erc20 - errc ', Utils.uint2str(res)));
        }

        // 3. Redeem collateral cToken for collateral
        uint collateralTokens = ICToken(data.cTokenCollateral).balanceOf(address(this));

        uint res = ICToken(data.cTokenCollateral).redeem(collateralTokens);
        require(res == 0, Utils.concat('reedem fail - errc ', Utils.uint2str(res)));

        address collateralTokenUnderlying;
        if (data.cTokenCollateral == CETH_ADDRESS) {
            // Uniswap needs us to have a balance of WETH to trade out
            // We can just swap our whole balance to WETH here, since we withdraw by ERC20 in other cases
            WETH9(WETH_ADDRESS).deposit.value(Utils.getBalance(address(this)))();
            collateralTokenUnderlying = WETH_ADDRESS;
        } else {
            collateralTokenUnderlying = ICToken(data.cTokenCollateral).underlying();
        }

        // 4. Now the flash loan can go through because we have a balance of collateral token to swap for our borrowed tokens
        MyERC20(collateralTokenUnderlying).transfer(data.uniswapPair, data.swapCollateralAmount);
    }

    function withdraw(address token) external {
        require(msg.sender == owner, "not owner");

        uint balance = MyERC20(token).balanceOf(address(this));

        MyERC20(token).transfer(msg.sender, balance);
    }

    function withdrawEth() external {
        require(msg.sender == owner, "not owner");

        msg.sender.send(Utils.getBalance(address(this)));
    }

    function enterMarkets(address comptroller, address[] calldata cTokens) external returns (uint[] memory) {
        require(msg.sender == owner, "not owner");
        return IComptroller(comptroller).enterMarkets(cTokens);
    }

    function exitMarket(address comptroller, address cToken) external returns (uint) {
        require(msg.sender == owner, "not owner");
        return IComptroller(comptroller).exitMarket(cToken);
    }
}
