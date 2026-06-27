// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ICloneAgent} from "../src/ICloneAgent.sol";
import {IERC6551Registry} from "../src/ICloneAgent.sol";

/// Minimal mock of the canonical ERC-6551 registry for wiring tests.
contract MockRegistry is IERC6551Registry {
    function account(address impl, bytes32 salt, uint256 chainId, address tc, uint256 id)
        public
        pure
        returns (address)
    {
        return address(uint160(uint256(keccak256(abi.encode(impl, salt, chainId, tc, id)))));
    }

    function createAccount(address impl, bytes32 salt, uint256 chainId, address tc, uint256 id)
        external
        pure
        returns (address)
    {
        return account(impl, salt, chainId, tc, id);
    }
}

contract ICloneAgentTest is Test {
    ICloneAgent agent;
    MockRegistry registry;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    address impl = makeAddr("impl6551");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    string constant URI = "https://gateway.irys.xyz/abc123";

    function setUp() public {
        registry = new MockRegistry();
        vm.prank(owner);
        agent = new ICloneAgent("iCLONE Agent", "INFT", owner, treasury, 500, address(registry), impl);
    }

    // ── minting ────────────────────────────────────────────────────────────────
    function test_OwnerMintsWithUri() public {
        vm.prank(owner);
        uint256 id = agent.mint(alice, URI);
        assertEq(id, 1);
        assertEq(agent.ownerOf(1), alice);
        assertEq(agent.tokenURI(1), URI);
        assertEq(agent.totalMinted(), 1);
        assertEq(agent.totalSupply(), 1);
    }

    function test_TokenIdsStartAtOne() public {
        vm.startPrank(owner);
        assertEq(agent.mint(alice, URI), 1);
        assertEq(agent.mint(alice, URI), 2);
        vm.stopPrank();
    }

    function test_RevertWhen_NotAuthorized() public {
        vm.prank(bob);
        vm.expectRevert(ICloneAgent.NotAuthorized.selector);
        agent.mint(bob, URI);
    }

    function test_RevertWhen_EmptyUri() public {
        vm.prank(owner);
        vm.expectRevert(ICloneAgent.EmptyURI.selector);
        agent.mint(alice, "");
    }

    function test_PublicMintWithPrice() public {
        vm.startPrank(owner);
        agent.setPublicMint(true);
        agent.setMintPrice(0.01 ether);
        vm.stopPrank();

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        agent.mint{value: 0.01 ether}(bob, URI);
        assertEq(agent.ownerOf(1), bob);
        assertEq(address(agent).balance, 0.01 ether);
    }

    function test_RevertWhen_WrongPayment() public {
        vm.startPrank(owner);
        agent.setPublicMint(true);
        agent.setMintPrice(0.01 ether);
        vm.stopPrank();

        vm.deal(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.WrongPayment.selector, 0.02 ether, 0.01 ether));
        agent.mint{value: 0.02 ether}(bob, URI);
    }

    function test_PrivilegedMintIsFreeEvenWithPrice() public {
        vm.startPrank(owner);
        agent.setMintPrice(0.5 ether);
        agent.mint(alice, URI); // owner pays nothing
        vm.stopPrank();
        assertEq(agent.ownerOf(1), alice);
    }

    // ── supply / pause ───────────────────────────────────────────────────────────
    function test_MaxSupplyEnforced() public {
        vm.startPrank(owner);
        agent.setMaxSupply(2);
        agent.mint(alice, URI);
        agent.mint(alice, URI);
        vm.expectRevert(ICloneAgent.MaxSupplyReached.selector);
        agent.mint(alice, URI);
        vm.stopPrank();
    }

    function test_RevertWhen_MaxSupplyBelowMinted() public {
        vm.startPrank(owner);
        agent.mint(alice, URI);
        agent.mint(alice, URI);
        vm.expectRevert(ICloneAgent.MaxSupplyBelowMinted.selector);
        agent.setMaxSupply(1);
        vm.stopPrank();
    }

    function test_PauseBlocksMint() public {
        vm.prank(owner);
        agent.pause();
        vm.prank(owner);
        vm.expectRevert();
        agent.mint(alice, URI);

        vm.prank(owner);
        agent.unpause();
        vm.prank(owner);
        agent.mint(alice, URI);
        assertEq(agent.ownerOf(1), alice);
    }

    // ── royalty (ERC-2981) ───────────────────────────────────────────────────────
    function test_RoyaltyIsFivePercent() public {
        vm.prank(owner);
        agent.mint(alice, URI);
        (address receiver, uint256 amount) = agent.royaltyInfo(1, 10_000);
        assertEq(receiver, treasury);
        assertEq(amount, 500); // 5%
    }

    function test_OwnerCanUpdateRoyalty() public {
        vm.prank(owner);
        agent.setDefaultRoyalty(alice, 250);
        (address receiver, uint256 amount) = agent.royaltyInfo(1, 10_000);
        assertEq(receiver, alice);
        assertEq(amount, 250);
    }

    // ── metadata ─────────────────────────────────────────────────────────────────
    function test_SetTokenURI() public {
        vm.prank(owner);
        agent.mint(alice, URI);
        vm.prank(owner);
        agent.setTokenURI(1, "https://gateway.irys.xyz/updated");
        assertEq(agent.tokenURI(1), "https://gateway.irys.xyz/updated");
    }

    function test_RevertWhen_TokenURINonexistent() public {
        vm.expectRevert(ICloneAgent.NonexistentToken.selector);
        agent.tokenURI(99);
    }

    // ── ERC-6551 ─────────────────────────────────────────────────────────────────
    function test_TokenAccountWiring() public {
        vm.prank(owner);
        agent.mint(alice, URI);
        address predicted = registry.account(impl, bytes32(0), block.chainid, address(agent), 1);
        assertEq(agent.tokenAccount(1), predicted);
        assertEq(agent.createTokenAccount(1), predicted);
    }

    // ── access control ───────────────────────────────────────────────────────────
    function test_RevertWhen_NonOwnerAdmin() public {
        vm.prank(bob);
        vm.expectRevert();
        agent.setMintPrice(1 ether);
    }

    function test_Ownable2StepTransfer() public {
        vm.prank(owner);
        agent.transferOwnership(alice);
        assertEq(agent.owner(), owner); // not yet
        vm.prank(alice);
        agent.acceptOwnership();
        assertEq(agent.owner(), alice);
    }

    // ── withdraw ─────────────────────────────────────────────────────────────────
    function test_Withdraw() public {
        vm.startPrank(owner);
        agent.setPublicMint(true);
        agent.setMintPrice(0.1 ether);
        vm.stopPrank();
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        agent.mint{value: 0.1 ether}(bob, URI);

        uint256 before = treasury.balance;
        vm.prank(owner);
        agent.withdraw(payable(treasury));
        assertEq(treasury.balance, before + 0.1 ether);
        assertEq(address(agent).balance, 0);
    }

    function test_RevertWhen_WithdrawNoBalance() public {
        vm.prank(owner);
        vm.expectRevert(ICloneAgent.NoBalance.selector);
        agent.withdraw(payable(treasury));
    }

    // ── interfaces ───────────────────────────────────────────────────────────────
    function test_SupportsInterfaces() public view {
        assertTrue(agent.supportsInterface(0x80ac58cd)); // ERC721
        assertTrue(agent.supportsInterface(0x5b5e139f)); // ERC721Metadata
        assertTrue(agent.supportsInterface(0x2a55205a)); // ERC2981
        assertTrue(agent.supportsInterface(0x01ffc9a7)); // ERC165
        assertFalse(agent.supportsInterface(0xdeadbeef));
    }

    // ── fuzz ─────────────────────────────────────────────────────────────────────
    function testFuzz_RoyaltyScales(uint96 bps, uint128 salePrice) public {
        bps = uint96(bound(bps, 0, 10_000));
        vm.prank(owner);
        agent.setDefaultRoyalty(treasury, bps);
        vm.prank(owner);
        agent.mint(alice, URI);
        (, uint256 amount) = agent.royaltyInfo(1, salePrice);
        assertEq(amount, (uint256(salePrice) * bps) / 10_000);
    }
}
