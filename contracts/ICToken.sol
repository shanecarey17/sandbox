pragma solidity ^0.6.0;

interface ICToken {
    function comptroller() external returns (address);
    function underlying() external returns (address);
}

interface ICEther {
    function liquidateBorrow(address borrower, address cTokenCollateral) external payable;
}

interface ICERC20 {
    function liquidateBorrow(address borrower, uint amount, address collateral) external returns (uint);
}