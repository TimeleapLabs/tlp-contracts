// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.5.0
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract Timeleap is ERC20, ERC20Permit {
    constructor(address recipient)
        ERC20("Timeleap", "TLP")
        ERC20Permit("Timeleap")
    {
        _mint(recipient, 1000000000 * 10 ** decimals());
    }
}
