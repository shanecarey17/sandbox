pragma solidity ^0.6.0;

interface ICToken {
    // Constants
    function comptroller() external returns (address);
    function underlying() external returns (address); // TODO remove

    // ERC 20
    function symbol() external view returns (string memory);
    function balanceOf(address) external view returns (uint);

    // Compound
    function redeem(uint redeemTokens) external returns (uint);

    function borrowBalanceStored(address account) external view returns (uint);
}

interface ICEther {    
    function liquidateBorrow(address borrower, address cTokenCollateral) external payable;

    function mint() external payable;

    function borrow(uint borrowAmount) external returns (uint);

    // Comes from CToken, but cant do inheritance on interfaces so sticking here
    function balanceOf(address) external view returns (uint);
    function borrowBalanceCurrent(address account) external returns (uint);
    function getAccountSnapshot(address account) external view returns (uint, uint, uint, uint);
}

interface ICERC20 {
    function underlying() external view returns (address);

    function mint(uint mintAmount) external returns (uint);

    function borrow(uint borrowAmount) external returns (uint);

    function liquidateBorrow(address borrower, uint amount, address collateral) external returns (uint);

    // Comes from CToken, but cant do inheritance on interfaces so sticking here
    function balanceOf(address) external view returns (uint);
    function getAccountSnapshot(address account) external view returns (uint, uint, uint, uint);
}
