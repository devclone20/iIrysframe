// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {FrameRoyaltySplit} from "../src/FrameRoyaltySplit.sol";

contract FrameRoyaltySplitTest is Test {
    FrameRoyaltySplit split;
    address creator = address(0xC0FFEE);
    address developer = address(0xDE7);
    address stranger = address(0xBAD);

    uint96 constant CREATOR_BPS = 500; // 5%
    uint96 constant DEV_BPS = 300; // 3%

    function setUp() public {
        split = new FrameRoyaltySplit(creator, developer, CREATOR_BPS, DEV_BPS);
    }

    function test_Split_ProportionalRelease() public {
        vm.deal(address(split), 1 ether);
        uint256 total = uint256(CREATOR_BPS) + DEV_BPS;

        split.release(payable(creator));
        split.release(payable(developer));

        assertEq(creator.balance, (1 ether * CREATOR_BPS) / total);
        assertEq(developer.balance, (1 ether * DEV_BPS) / total);
        // sum equals the pot (± integer dust ≤ 1 wei)
        assertApproxEqAbs(creator.balance + developer.balance, 1 ether, 1);
    }

    function test_Split_ReleaseTwiceNothingDue() public {
        vm.deal(address(split), 1 ether);
        split.release(payable(creator));
        vm.expectRevert(FrameRoyaltySplit.NothingDue.selector);
        split.release(payable(creator));
    }

    function test_Split_IncrementalReceives() public {
        vm.deal(address(split), 1 ether);
        split.release(payable(developer));
        uint256 first = developer.balance;

        // more royalties arrive
        vm.deal(address(split), address(split).balance + 1 ether);
        split.release(payable(developer));
        uint256 total = uint256(CREATOR_BPS) + DEV_BPS;
        // developer's cumulative take == devBps share of 2 ETH total received
        assertEq(developer.balance, (2 ether * DEV_BPS) / total);
        assertGt(developer.balance, first);
    }

    function test_Split_NonPayeeReverts() public {
        vm.deal(address(split), 1 ether);
        vm.expectRevert(FrameRoyaltySplit.NotAPayee.selector);
        split.release(payable(stranger));
    }

    function test_Split_ConstructorZeroAddr() public {
        vm.expectRevert(FrameRoyaltySplit.ZeroAddress.selector);
        new FrameRoyaltySplit(address(0), developer, CREATOR_BPS, DEV_BPS);
    }

    function test_Split_ConstructorZeroShares() public {
        vm.expectRevert(FrameRoyaltySplit.BadShares.selector);
        new FrameRoyaltySplit(creator, developer, CREATOR_BPS, 0);
    }

    /// Fuzz: releasing every non-zero share conserves funds — payouts plus the
    /// sub-unit integer-division dust left behind always equal the pot exactly.
    function testFuzz_Split_ConservesFunds(uint96 pot) public {
        vm.assume(pot > 0);
        vm.deal(address(split), pot);
        if (split.pending(creator) > 0) split.release(payable(creator));
        if (split.pending(developer) > 0) split.release(payable(developer));
        assertEq(creator.balance + developer.balance + address(split).balance, uint256(pot));
        assertLt(address(split).balance, 2); // ≤ 1 wei dust from integer division
    }
}
