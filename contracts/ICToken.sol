pragma solidity ^0.6.0;

interface ICToken {
    // Constants
    function comptroller() external returns (address);
    function underlying() external returns (address);

    // ERC 20
    function symbol() external view returns (string memory);
    function balanceOf(address) external view returns (uint);

    // Compound
    function redeem(uint redeemTokens) external returns (uint);

    function borrowBalanceStored(address account) external view returns (uint);
}

interface ICEther {    
    function liquidateBorrow(address borrower, address cTokenCollateral) external payable;
}

interface ICERC20 {
    function liquidateBorrow(address borrower, uint amount, address collateral) external returns (uint);
}