pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./ICToken.sol";
import "./MyERC20.sol";
import "./IComptroller.sol";
import "./Utils.sol";

contract CompoundLiquidatorLite {
    address constant public CETH_ADDRESS            = 0x4Ddc2D193948926D02f9B1fE9e1daa0718270ED5;

    address public owner;
    mapping(address => bool) public callers;

    constructor() public {
        owner = msg.sender;
        callers[owner] = true;
    }

    // Required to receive ether
    fallback() external payable {}
    receive() external payable {}

    function liquidate(address borrowAccount, address cTokenBorrowed, address cTokenCollateral, uint repayBorrowAmount) external returns (uint) {
        require(callers[msg.sender], "not caller");
        require(ICToken(cTokenBorrowed).comptroller() == ICToken(cTokenCollateral).comptroller(), "cTokens have different comptrollers");
        require(repayBorrowAmount > 0, "zero repayBorrowAmount");

        // 1. Repay borrowed loan and receive collateral
        if (cTokenBorrowed == CETH_ADDRESS) {
            // Do the liquidate, value() specifies the repay amount in ETH
            ICEther(cTokenBorrowed).liquidateBorrow.value(repayBorrowAmount)(borrowAccount, cTokenCollateral);
        } else {
            require(MyERC20(ICToken(cTokenBorrowed).underlying()).balanceOf(address(this)) >= repayBorrowAmount, "insufficient bal");
            // Easy we already have the balance
            address underlyingAddress = ICToken(cTokenBorrowed).underlying();
            // Need to approve 0 first for USDT bug
            MyERC20(underlyingAddress).approve(cTokenBorrowed, 0);
            MyERC20(underlyingAddress).approve(cTokenBorrowed, repayBorrowAmount);

            uint res = ICERC20(cTokenBorrowed).liquidateBorrow(borrowAccount, repayBorrowAmount, cTokenCollateral);

            if (res != 0) {
                // Dont do string manip unless we failed (save gas)
                require(false, Utils.concat('liquidate fail erc20 - errc ', Utils.uint2str(res)));
            }
        }

        // 3. Transfer collateral to owner account
        uint collateralTokens = ICToken(cTokenCollateral).balanceOf(address(this));

        bool success = MyERC20(cTokenCollateral).transfer(owner, collateralTokens);
        require(success, "transfer out failed");

        return collateralTokens;
    }

    function withdraw(address token) external {
        require(msg.sender == owner, "not owner");

        uint balance = MyERC20(token).balanceOf(address(this));

        MyERC20(token).transfer(msg.sender, balance);
    }

    function withdrawEth() external {
        require(msg.sender == owner, "not owner");

        msg.sender.transfer(Utils.getBalance(address(this)));
    }

    function whitelistCaller(address _caller) external {
        require(msg.sender == owner, "not owner");
        callers[_caller] = true;
    }

    function blacklistCaller(address _caller) external {
        require(msg.sender == owner, "not owner");
        callers[_caller] = false;
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
