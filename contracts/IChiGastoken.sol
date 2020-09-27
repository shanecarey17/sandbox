pragma solidity ^0.6.0;

interface IChiGastoken {
    function mint(uint value) external;

    function free(uint value) external returns (uint);
    function freeUpTo(uint value) external returns (uint);
    function freeFrom(address spender, uint value) external returns (uint);
    function freeFromUpTo(address spender, uint value) external returns (uint);

    function transfer(address to, uint value) external returns (bool);
}
