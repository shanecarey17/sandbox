pragma solidity ^0.6.0;
pragma experimental ABIEncoderV2;

import "./DydxFlashloanBase.sol";
import "./ICallee.sol";
import "./IKyberNetworkProxy.sol";
import "./MyERC20.sol"; // Has decimals()
import "./Utils.sol";

contract StrategyV1 is ICallee, DydxFlashloanBase {
    mapping (address => uint) internal owners;
    mapping (address => uint) internal callPermitted;

    address constant KYBER_ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    struct CallData {
        address tokenA;
        address tokenB;
        address tokenC;
        uint256 loanAmountA;
        uint256 repayAmountA;
        address kyberAddress;
    }

    event LOG(
        uint amount0,
        uint rate0,
        uint amount1,
        uint rate1,
        uint amount2,
        uint rate2,
        uint amount3
    );

    constructor() public {
        owners[msg.sender] = 1;
    }

    // Required to receive ether
    fallback() external payable {}
    receive() external payable {}

    modifier ownerOnly() {
        require(owners[msg.sender] == 1, "me/naw");
        _;
    }

    function grant(address usr) external ownerOnly {
        owners[usr] = 1;
    }

    function revoke(address usr) external ownerOnly {
        // TODO prevent creator from exiting?
        owners[usr] = 0;
    }

    function withdraw(address token, uint256 amount) external ownerOnly {
        if (token == KYBER_ETH_ADDRESS) {
            payable(address(msg.sender)).send(amount);
        } else {
            MyERC20(token).transfer(msg.sender, amount);
        }
    }

    function initiateFlashLoan(address _solo, address _kyber, address _tokenA, address _tokenB, address _tokenC, uint256 _amountA) external payable ownerOnly {
        // TODO require auth, maybe? 
        // Is it unsafe for someone else to call this and pay for gas? 
        // Assuming the contract cannot go negative.

        // Solo does not support ether loans, directly 
        // initiate the swap from our balance
        if (_tokenA == KYBER_ETH_ADDRESS) {
            Account.Info[] memory accountInfos = new Account.Info[](1);
            accountInfos[0] = _getAccountInfo();

            callPermitted[msg.sender] = 1;

            callFunction(address(this),
                accountInfos[0],
                abi.encode(
                    CallData({
                        tokenA: _tokenA,
                        tokenB: _tokenB,
                        tokenC: _tokenC,
                        loanAmountA: _amountA,
                        repayAmountA: 0, // TODO
                        kyberAddress: _kyber
                    })
                )
            );

            callPermitted[msg.sender] = 0;

            return;
        }

        // Otherwise do the flash loan
        ISoloMargin solo = ISoloMargin(_solo);

        uint256 marketIdA = _getMarketIdFromTokenAddress(_solo, _tokenA);
        uint256 repayAmountA = _getRepaymentAmountInternal(_amountA);

        MyERC20(_tokenA).approve(_solo, repayAmountA);

        Actions.ActionArgs[] memory operations = new Actions.ActionArgs[](3);

        operations[0] = _getWithdrawAction(marketIdA, _amountA);

        operations[1] = _getCallAction(
            abi.encode(
                CallData({
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

        // The call method is public, so ensure that it can only be invoked
        // through here by temporarily allowing the solo contract to invoke
        // it. Solo calls the method through the OperationImpl library, which
        // maintains msg.sender of the calling contract (ie.. solo) 
        callPermitted[_solo] = 1;

        solo.operate(accountInfos, operations);

        callPermitted[_solo] = 0;
    }

    function callFunction(address sender, Account.Info memory account, bytes memory data) public override {
        require(callPermitted[msg.sender] == 1, "me/nah");

        CallData memory cd = abi.decode(data, (CallData));

        uint initialBalance = cd.tokenA == KYBER_ETH_ADDRESS ?
            Utils.getBalance(address(this))
            : MyERC20(cd.tokenA).balanceOf(address(this));

        (uint rateAB, uint rateBC, uint rateCA) = getRates(cd);

        // Or just do trade with external rates passed in to save gas?
        (uint amountB, uint amountC, uint amountA) = doSwap(cd, rateAB, rateBC, rateCA);

        uint finalBalance = cd.tokenA == KYBER_ETH_ADDRESS ?
            Utils.getBalance(address(this))
            : MyERC20(cd.tokenA).balanceOf(address(this));

        // TODO check profit?? Or just collateralization? Or neither?
        require(finalBalance > cd.repayAmountA, "me/2lo");

        emit LOG(cd.loanAmountA, rateAB, amountB, rateBC, amountC, rateCA, amountA);
    }

    function getRates(CallData memory cd) internal returns (uint rAB, uint rBC, uint rCA) {
        (uint rateAB, uint slippageAB) = getExpectedRate(cd.kyberAddress, cd.tokenA, cd.tokenB, cd.loanAmountA);
        uint amountB = calcDestAmount(cd.tokenA, cd.tokenB, cd.loanAmountA, rateAB);

        (uint rateBC, uint slippageBC) = getExpectedRate(cd.kyberAddress, cd.tokenB, cd.tokenC, amountB);
        uint amountC = calcDestAmount(cd.tokenB, cd.tokenC, amountB, rateAB);

        (uint rateCA, uint slippageCA) = getExpectedRate(cd.kyberAddress, cd.tokenC, cd.tokenA, amountC);
        uint amountA = calcDestAmount(cd.tokenC, cd.tokenA, amountC, rateCA);

        return (slippageAB, slippageBC, slippageCA); // TODO is this the right rate?
    }

    function getExpectedRate(address kyber, address src, address dst, uint256 srcAmount) internal view 
        returns (uint256 expectedRate, uint256 slippageRate) {

        return IKyberNetworkProxy(kyber).getExpectedRate(IERC20(src), IERC20(dst), srcAmount);
    }

    function calcDestAmount(address src, address dst, uint256 srcAmount, uint256 exchRate) internal view
        returns (uint dstAmount) {

        uint srcDecimals = (src == KYBER_ETH_ADDRESS) ? 18 : MyERC20(src).decimals();
        uint dstDecimals = (dst == KYBER_ETH_ADDRESS) ? 18 : MyERC20(dst).decimals();

        if (dstDecimals >= srcDecimals) {
            return (srcAmount * exchRate * (10**(dstDecimals - srcDecimals))) / (10**18);
        } else {
            return (srcAmount * exchRate) / (10**(srcDecimals - dstDecimals + 18));
        }
    }

    function doSwap(CallData memory cd, uint rateAB, uint rateBC, uint rateCA) internal 
        returns (uint amountB, uint amountC, uint amountA) {

        uint swappedAB = swapTokens(cd.kyberAddress, cd.tokenA, cd.tokenB, cd.loanAmountA, rateAB);
        uint swappedBC = swapTokens(cd.kyberAddress, cd.tokenB, cd.tokenC, swappedAB, rateBC);
        uint swappedCA = swapTokens(cd.kyberAddress, cd.tokenC, cd.tokenA, swappedBC, rateCA);

        return (swappedAB, swappedBC, swappedCA);
    }

    function swapTokens(address kyber, address src, address dst, uint256 srcAmount, uint256 minExchRate) internal 
        returns (uint256 dstAmount) {

        require(src != dst, "me/same-curr");

        if (src == KYBER_ETH_ADDRESS) {
            require(Utils.getBalance(address(this)) >= srcAmount, "me/eth");

            return IKyberNetworkProxy(kyber).swapEtherToToken.value(srcAmount)(IERC20(dst), minExchRate);
        } else {
            IERC20(src).approve(kyber, srcAmount);

            if (dst == KYBER_ETH_ADDRESS) {
                return IKyberNetworkProxy(kyber).swapTokenToEther(IERC20(src), srcAmount, minExchRate);
            } else {
                return IKyberNetworkProxy(kyber).swapTokenToToken(IERC20(src), srcAmount, IERC20(dst), minExchRate);
            }
        }
    }
}
