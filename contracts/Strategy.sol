pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./DydxFlashloanBase.sol";
import "./ICallee.sol";
import "./IKyberNetworkProxy.sol";

contract StrategyV1 is ICallee, DydxFlashloanBase {
    address owner;

    struct MyCustomData {
        address tokenA;
        address tokenB;
        address tokenC;
        uint256 loanAmountA;
        uint256 repayAmountA;
        address kyberAddress;
    }

    event LOG1();
    event LOG2();
    event LOG3();
    event LOG4();
    event LOG5(address, address, address, uint256);
    event LOG6(uint, uint, uint, uint, uint, uint, int);
    event LOG7(uint, uint, uint);

    constructor() public {
        owner = msg.sender;
    }

    function initiateFlashLoan(
        address _solo,
        address _kyber,
        address _tokenA,
        address _tokenB,
        address _tokenC,
        uint256 _amountA
    ) external {
        ISoloMargin solo = ISoloMargin(_solo);

        uint256 marketIdA = _getMarketIdFromTokenAddress(_solo, _tokenA);
        uint256 repayAmountA = _getRepaymentAmountInternal(_amountA);

        IERC20(_tokenA).approve(_solo, repayAmountA);

        Actions.ActionArgs[] memory operations = new Actions.ActionArgs[](3);

        operations[0] = _getWithdrawAction(marketIdA, _amountA);

        operations[1] = _getCallAction(
            abi.encode(
                MyCustomData({
                    tokenA: _tokenA,
                    tokenB: _tokenB,
                    tokenC: _tokenC,
                    loanAmountA: _amountA,
                    repayAmountA: repayAmountA,
                    kyberAddress: _kyber
                })
            )
        );

        operations[2] = _getDepositAction(marketIdA, repayAmountA);

        Account.Info[] memory accountInfos = new Account.Info[](1);
        accountInfos[0] = _getAccountInfo();

        solo.operate(accountInfos, operations);
    }

    function callFunction(
        address sender,
        Account.Info memory account,
        bytes memory data
    ) public override {
        // TODO ensure called through other func
        MyCustomData memory mcd = abi.decode(data, (MyCustomData));

        uint256 balanceAPre = IERC20(mcd.tokenA).balanceOf(address(this));

        emit LOG5(sender, account.owner, address(this), balanceAPre);

        (uint rateAB, uint slippageAB) = getExpectedRate(mcd.kyberAddress, mcd.tokenA, mcd.tokenB, mcd.loanAmountA);

        uint amountB = mcd.loanAmountA * rateAB / (10**18);
        (uint rateBC, uint slippageBC) = getExpectedRate(mcd.kyberAddress, mcd.tokenB, mcd.tokenC, amountB);

        uint amountC = amountB * rateBC / (10**18);
        (uint rateCA, uint slippageCA) = getExpectedRate(mcd.kyberAddress, mcd.tokenC, mcd.tokenA, amountC);

        uint amountA = amountC * rateCA / (10**18);

        //emit LOG6(rateAB, slippageAB, rateBC, slippageBC, rateCA, slippageCA, int(amountA - mcd.loanAmountA));

        doSwap(mcd, slippageAB, slippageBC, slippageCA);

        uint balanceAPost = IERC20(mcd.tokenA).balanceOf(address(this));

        require(balanceAPost > mcd.repayAmountA, "no profit");
    }

    function doSwap(MyCustomData memory mcd, uint rateAB, uint rateBC, uint rateCA) internal returns (uint) {
        uint swappedAB = swapTokens(mcd.kyberAddress, mcd.tokenA, mcd.tokenB, mcd.loanAmountA, rateAB);
        require(false, "int2str(swappedAB)");
        uint swappedBC = swapTokens(mcd.kyberAddress, mcd.tokenB, mcd.tokenC, swappedAB, rateBC);
        uint swappedCA = swapTokens(mcd.kyberAddress, mcd.tokenC, mcd.tokenA, swappedBC, rateCA);

        emit LOG7(swappedAB, swappedBC, swappedCA);

        return swappedCA;
    }

    function swapTokens(
        address kyberAddress,
        address from,
        address to,
        uint256 tokenAmount,
        uint256 minConversionRate
    ) internal returns (uint256) {
        IKyberNetworkProxy kyber = IKyberNetworkProxy(kyberAddress);

        IERC20(from).approve(kyberAddress, tokenAmount);

        return
            kyber.swapTokenToToken(
                IERC20(from),
                tokenAmount,
                IERC20(to),
                minConversionRate
            );
    }

    function getExpectedRate(
        address kyberAddress,
        address from,
        address to,
        uint256 fromAmount
    ) internal view returns (uint256 expectedRate, uint256 slippageRate) {
        IERC20 fromToken = IERC20(from);
        IERC20 toToken = IERC20(to);

        IKyberNetworkProxy kyber = IKyberNetworkProxy(kyberAddress);

        return kyber.getExpectedRate(fromToken, toToken, fromAmount);
    }

    function int2str(int i) internal pure returns (string memory) {
        if (i == 0) return "0";
        bool negative = i < 0;
        uint j = uint(negative ? -i : i);
        uint l = j;     // Keep an unsigned copy
        uint len;
        while (j != 0){
            len++;
            j /= 10;
        }
        if (negative) ++len;  // Make room for '-' sign
        bytes memory bstr = new bytes(len);
        uint k = len - 1;
        while (l != 0){
            bstr[k--] = byte(48 + uint8(l) % 10);
            l /= 10;
        }
        if (negative) {    // Prepend '-'
            bstr[0] = '-';
        }
        return string(bstr);
    }

    function withdraw(address token, uint256 amount) external {
        require(msg.sender == owner, "not owner");
        IERC20(token).transfer(owner, amount);
    }
}
