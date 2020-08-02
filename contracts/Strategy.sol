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
        address solo;
        address kyber;

        address tokenA;
        uint256 rateAB;
        address tokenB;
        uint256 rateBC;
        address tokenC;
        uint256 rateCA;

        uint256 amountA;
        uint256 minReturnA;
    }

    event LOG(
        uint amount0,
        uint amount1,
        uint amount2,
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

    modifier permitted() {
        require(callPermitted[msg.sender] == 1, "me/no");
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
        // TODO do max to avoid revert
        if (token == KYBER_ETH_ADDRESS) {
            payable(address(msg.sender)).transfer(amount);
        } else {
            MyERC20(token).transfer(msg.sender, amount);
        }
    }

    function trade(CallData calldata _cd) external payable ownerOnly {
        CallData memory cd = _cd;

        // Solo does not support ether loans, directly 
        // initiate the swap from our balance
        // TODO solo does not have balance of token
        bool noLoan = false;

        uint myTokenBalance = 0;

        if (cd.tokenA == KYBER_ETH_ADDRESS) {
            noLoan = true;
        } else {
            myTokenBalance = IERC20(cd.tokenA).balanceOf(address(this));

            if (myTokenBalance >= cd.amountA) {
                noLoan = true;
            }
        }

        if (noLoan) {
            tradeNoLoan(cd);
        } else {
            uint loanAmount = cd.amountA - myTokenBalance;

            tradeWithLoan(cd, loanAmount);
        }
    }

    function tradeNoLoan(CallData memory cd) internal {
        Account.Info[] memory accountInfos = new Account.Info[](1);
        accountInfos[0] = _getAccountInfo();

        cd.minReturnA = 0;

        callPermitted[msg.sender] = 1;
        callFunction(address(this), accountInfos[0], abi.encode(cd));
        callPermitted[msg.sender] = 0;
    }

    function tradeWithLoan(CallData memory cd, uint loanAmount) internal {
        uint256 marketIdA = _getMarketIdFromTokenAddress(cd.solo, cd.tokenA);
        uint256 minReturnA = _getRepaymentAmountInternal(loanAmount);

        cd.minReturnA = minReturnA;

        MyERC20(cd.tokenA).approve(cd.solo, minReturnA);

        Actions.ActionArgs[] memory operations = new Actions.ActionArgs[](3);

        operations[0] = _getWithdrawAction(marketIdA, cd.amountA);
        operations[1] = _getCallAction(abi.encode(cd));
        operations[2] = _getDepositAction(marketIdA, minReturnA);

        Account.Info[] memory accountInfos = new Account.Info[](1);
        accountInfos[0] = _getAccountInfo();

        // The call method is public, so ensure that it can only be invoked
        // through here by temporarily allowing the solo contract to invoke
        // it. Solo calls the method through the OperationImpl library, which
        // maintains msg.sender of the calling contract (ie.. solo) 
        callPermitted[cd.solo] = 1;
        ISoloMargin(cd.solo).operate(accountInfos, operations);
        callPermitted[cd.solo] = 0;
    }

    function callFunction(address sender, Account.Info memory account, bytes memory data) public override permitted {
        CallData memory cd = abi.decode(data, (CallData));

        uint initialBalance = getMyBalance(cd.tokenA);

        (uint amountB, uint amountC, uint amountA) = doSwap(cd);

        uint finalBalance = getMyBalance(cd.tokenA);

        int profit = int(finalBalance - initialBalance);

        // TODO check profit?? Or just collateralization? Or neither?
        require(profit < int(cd.minReturnA), "me/2lo");

        emit LOG(cd.amountA, amountB, amountC, amountA);
    }

    function getMyBalance(address token) internal returns (uint) {
        if (token == KYBER_ETH_ADDRESS) {
            return Utils.getBalance(address(this));
        } else {
            return IERC20(token).balanceOf(address(this));
        }
    }

    function doSwap(CallData memory cd) internal returns (uint amountB, uint amountC, uint amountA) {
        uint swappedAB = swapTokens(cd.kyber, cd.tokenA, cd.tokenB, cd.amountA, cd.rateAB);
        uint swappedBC = swapTokens(cd.kyber, cd.tokenB, cd.tokenC, swappedAB, cd.rateBC);
        uint swappedCA = swapTokens(cd.kyber, cd.tokenC, cd.tokenA, swappedBC, cd.rateCA);

        return (swappedAB, swappedBC, swappedCA);
    }

    function swapTokens(address kyber, address src, address dst, uint256 srcAmount, uint256 minExchRate) internal returns (uint256 dstAmount) {

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
