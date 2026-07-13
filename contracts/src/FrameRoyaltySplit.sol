// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/**
 * @title  FrameRoyaltySplit
 * @notice Immutable two-payee ETH splitter used as the ERC-2981 receiver when a
 *         collection opts into PERPETUAL developer support. Marketplaces send the
 *         whole secondary royalty here; creator and developer each PULL their
 *         proportional bps share. No owner, no setters, no upgrade path.
 * @dev    OpenZeppelin PaymentSplitter's proportional-release math, reduced to two
 *         fixed payees and hardened (ETH-only, no owner, no ERC-20 surface).
 *         Pull-only; checks-effects-interactions; reentrancy-safe by construction.
 */
contract FrameRoyaltySplit {
    using Address for address payable;

    address public immutable creator;
    address public immutable developer;
    uint96 public immutable creatorBps; // of sale price
    uint96 public immutable devBps; // of sale price (100..500 = 1%..5%)

    uint256 public totalReleased;
    mapping(address => uint256) public released;

    event PaymentReceived(address indexed from, uint256 amount);
    event PaymentReleased(address indexed to, uint256 amount);

    error NotAPayee();
    error NothingDue();
    error ZeroAddress();
    error BadShares();

    constructor(address creator_, address developer_, uint96 creatorBps_, uint96 devBps_) {
        if (creator_ == address(0) || developer_ == address(0)) revert ZeroAddress();
        if (creatorBps_ == 0 || devBps_ == 0) revert BadShares();
        creator = creator_;
        developer = developer_;
        creatorBps = creatorBps_;
        devBps = devBps_;
    }

    receive() external payable {
        emit PaymentReceived(msg.sender, msg.value);
    }

    function _shareOf(address account) internal view returns (uint96) {
        if (account == creator) return creatorBps;
        if (account == developer) return devBps;
        return 0;
    }

    /// @notice ETH still owed to `account` given everything received so far.
    function pending(address account) public view returns (uint256) {
        uint96 share = _shareOf(account);
        if (share == 0) return 0;
        uint256 totalReceived = address(this).balance + totalReleased;
        return (totalReceived * share) / (uint256(creatorBps) + devBps) - released[account];
    }

    /// @notice Anyone may trigger a release; funds only ever go to creator or developer.
    function release(address payable account) external {
        uint96 share = _shareOf(account);
        if (share == 0) revert NotAPayee();
        uint256 due = pending(account);
        if (due == 0) revert NothingDue();
        released[account] += due; // effects
        totalReleased += due;
        emit PaymentReleased(account, due);
        account.sendValue(due); // interaction
    }
}
