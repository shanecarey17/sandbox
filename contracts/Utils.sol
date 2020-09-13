pragma solidity ^0.6.0;

library Utils {
    function uint2str(uint _i) internal pure returns (string memory) {
        if (_i == 0) {
            return "0";
        }
        uint j = _i;
        uint len;
        while (j != 0) {
            len++;
            j /= 10;
        }
        bytes memory bstr = new bytes(len);
        uint k = len - 1;
        while (_i != 0) {
            bstr[k--] = byte(uint8(48 + _i % 10));
            _i /= 10;
        }
        return string(bstr);
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

    function addr2str(address x) internal pure returns (string memory) {
        bytes memory s = new bytes(40);
        for (uint i = 0; i < 20; i++) {
            byte b = byte(uint8(uint(x) / (2**(8*(19 - i)))));
            byte hi = byte(uint8(b) / 16);
            byte lo = byte(uint8(b) - 16 * uint8(hi));
            s[2*i] = char(hi);
            s[2*i+1] = char(lo);            
        }
        return string(s);
    }

    function char(byte b) internal pure returns (byte) {
        if (uint8(b) < 10) return byte(uint8(b) + 0x30);
        else return byte(uint8(b) + 0x57);
    }

    function getBalance(address addr) internal view returns (uint) {
        return addr.balance;
    }

    function compareStrings(string memory a, string memory b) public pure returns (bool) {
      return (keccak256(abi.encodePacked((a))) == keccak256(abi.encodePacked((b))));
    }

    function concat(string memory a, string memory b) internal pure returns (string memory) {
        return string(abi.encodePacked(a, b));
    }
}