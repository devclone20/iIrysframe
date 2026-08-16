// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {CloneForge} from "../src/CloneForge.sol";
import {ERC721A} from "erc721a/contracts/ERC721A.sol";

contract MockOG is ERC721A("OG PASS", "OG") {
    function mint(address to) external {
        _mint(to, 1);
    }
}

contract CloneForgeTest is Test {
    CloneForge forge_;
    MockOG og;

    address owner = address(0xA11CE);
    address holder = address(0xB0B);
    address stranger = address(0xCAFE);
    address developer = address(0xDE7);

    function _config() internal view returns (CloneForge.Config memory c) {
        c = CloneForge.Config({
            name: "Test Drop",
            symbol: "TDROP",
            owner: owner,
            royaltyReceiver: owner,
            royaltyBps: 500,
            maxSupply: 5,
            mintPrice: 0.01 ether,
            publicMint: true,
            walletLimit: 2,
            ogCard: address(og),
            contractURI_: "https://gateway.irys.xyz/collection-profile",
            dropBaseURI: "https://gateway.irys.xyz/manifest/",
            erc6551Registry: address(0),
            erc6551Implementation: address(0),
            developer: address(0),
            devBps: 0,
            supportMode: CloneForge.SupportMode.None
        });
    }

    function setUp() public {
        og = new MockOG();
        forge_ = new CloneForge(_config());
        vm.deal(holder, 1 ether);
        vm.deal(stranger, 1 ether);
    }

    function test_OwnerMintsFreeWithURI() public {
        vm.prank(owner);
        uint256 id = forge_.mint(owner, "https://gateway.irys.xyz/item-1");
        assertEq(id, 1);
        assertEq(forge_.tokenURI(1), "https://gateway.irys.xyz/item-1");
    }

    function test_OgGateBlocksNonHolders() public {
        vm.prank(stranger);
        vm.expectRevert(CloneForge.OgCardRequired.selector);
        forge_.mintDrop{value: 0.01 ether}(1);
    }

    function test_OgHolderDropMints() public {
        og.mint(holder);
        vm.prank(holder);
        forge_.mintDrop{value: 0.02 ether}(2);
        assertEq(forge_.balanceOf(holder), 2);
        // sequential URIs from dropBaseURI
        assertEq(forge_.tokenURI(1), "https://gateway.irys.xyz/manifest/1");
        assertEq(forge_.tokenURI(2), "https://gateway.irys.xyz/manifest/2");
    }

    function test_WalletLimitEnforced() public {
        og.mint(holder);
        vm.prank(holder);
        forge_.mintDrop{value: 0.02 ether}(2);
        vm.prank(holder);
        vm.expectRevert(CloneForge.WalletLimitReached.selector);
        forge_.mintDrop{value: 0.01 ether}(1);
    }

    function test_WrongPaymentReverts() public {
        og.mint(holder);
        vm.prank(holder);
        vm.expectRevert(abi.encodeWithSelector(CloneForge.WrongPayment.selector, 0, 0.01 ether));
        forge_.mintDrop(1);
    }

    function test_MaxSupplyEnforced() public {
        vm.startPrank(owner);
        for (uint256 i = 0; i < 5; i++) forge_.mint(owner, "https://gateway.irys.xyz/x");
        vm.expectRevert(CloneForge.MaxSupplyReached.selector);
        forge_.mint(owner, "https://gateway.irys.xyz/x");
        vm.stopPrank();
    }

    function test_PublicMintToggleAndFreeOgMint() public {
        // owner turns price to 0 → OG holders mint paying only gas
        vm.prank(owner);
        forge_.setMintPrice(0);
        og.mint(holder);
        vm.prank(holder);
        forge_.mintDrop(1);
        assertEq(forge_.balanceOf(holder), 1);
    }

    function test_PublicOffBlocksEveryone() public {
        vm.prank(owner);
        forge_.setPublicMint(false);
        og.mint(holder);
        vm.prank(holder);
        vm.expectRevert(CloneForge.NotAuthorized.selector);
        forge_.mintDrop{value: 0.01 ether}(1);
    }

    function test_PerTokenURIOverridesDrop() public {
        og.mint(holder);
        vm.prank(holder);
        forge_.mintDrop{value: 0.01 ether}(1);
        vm.prank(owner);
        forge_.setTokenURI(1, "https://gateway.irys.xyz/evolved");
        assertEq(forge_.tokenURI(1), "https://gateway.irys.xyz/evolved");
    }

    function test_RoyaltyAndContractURI() public view {
        (address rcv, uint256 amt) = forge_.royaltyInfo(1, 10_000);
        assertEq(rcv, owner);
        assertEq(amt, 500); // 5%
        assertEq(forge_.contractURI(), "https://gateway.irys.xyz/collection-profile");
    }

    function test_OgGateClearable() public {
        vm.prank(owner);
        forge_.setOgCard(address(0));
        vm.prank(stranger);
        forge_.mintDrop{value: 0.01 ether}(1);
        assertEq(forge_.balanceOf(stranger), 1);
    }

    function test_WithdrawToOwner() public {
        og.mint(holder);
        vm.prank(holder);
        forge_.mintDrop{value: 0.01 ether}(1);
        uint256 before = owner.balance;
        vm.prank(owner);
        forge_.withdraw(payable(owner));
        assertEq(owner.balance, before + 0.01 ether);
    }

    // ── developer-support fee ────────────────────────────────────────────────
    /// A config in the given support mode (open OG gate so `stranger` can mint).
    function _supportConfig(CloneForge.SupportMode mode, uint96 devBps_)
        internal
        view
        returns (CloneForge.Config memory c)
    {
        c = _config();
        c.ogCard = address(0); // open mint for split accounting tests
        c.supportMode = mode;
        c.developer = mode == CloneForge.SupportMode.None ? address(0) : developer;
        c.devBps = devBps_;
    }

    function _deploy(CloneForge.Config memory c) internal returns (CloneForge f) {
        f = new CloneForge(c);
    }

    // config & bounds
    function test_ModeNone_NoDevFields() public view {
        (address rcv,) = forge_.royaltyInfo(1, 10_000);
        assertEq(rcv, owner);
        assertEq(uint256(forge_.supportMode()), uint256(CloneForge.SupportMode.None));
        assertEq(forge_.developer(), address(0));
    }

    function test_ModeNone_RejectsNonZeroDevBps() public {
        CloneForge.Config memory c = _config();
        c.devBps = 300;
        vm.expectRevert(CloneForge.BadDevConfig.selector);
        _deploy(c);
    }

    function test_DevBps_BoundsLow() public {
        vm.expectRevert(CloneForge.BadDevConfig.selector);
        _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 99));
    }

    function test_DevBps_BoundsHigh() public {
        vm.expectRevert(CloneForge.BadDevConfig.selector);
        _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 501));
    }

    function test_Support_ZeroDeveloperReverts() public {
        CloneForge.Config memory c = _supportConfig(CloneForge.SupportMode.FirstSale, 300);
        c.developer = address(0);
        vm.expectRevert(CloneForge.ZeroAddress.selector);
        _deploy(c);
    }

    // first-sale split
    function test_FirstSale_AccruesOnPaidMint() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300)); // 3%
        vm.prank(stranger);
        f.mintDrop{value: 0.02 ether}(2);
        assertEq(f.devAccrued(), (0.02 ether * 300) / 10_000);
    }

    function test_FirstSale_FreeMintNoAccrual() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        vm.prank(owner); // owner mints free
        f.mint(owner, "https://gateway.irys.xyz/x");
        assertEq(f.devAccrued(), 0);
    }

    function test_FirstSale_WithdrawReservesDevCut() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        vm.prank(stranger);
        f.mintDrop{value: 0.02 ether}(2);
        uint256 dev = f.devAccrued();
        uint256 before = owner.balance;
        vm.prank(owner);
        f.withdraw(payable(owner));
        assertEq(owner.balance, before + (0.02 ether - dev));
        assertEq(f.devAccrued(), dev); // dev cut untouched by owner withdraw
    }

    function test_FirstSale_WithdrawDevPaysDeveloper() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        vm.prank(stranger);
        f.mintDrop{value: 0.02 ether}(2);
        uint256 dev = f.devAccrued();
        uint256 before = developer.balance;
        f.withdrawDev();
        assertEq(developer.balance, before + dev);
        assertEq(f.devAccrued(), 0);
    }

    function test_FirstSale_WithdrawDevTwiceReverts() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        vm.prank(stranger);
        f.mintDrop{value: 0.01 ether}(1);
        f.withdrawDev();
        vm.expectRevert(CloneForge.NoBalance.selector);
        f.withdrawDev();
    }

    function test_FirstSale_SecondaryRoyaltyUnchanged() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        (address rcv, uint256 amt) = f.royaltyInfo(1, 10_000);
        assertEq(rcv, owner); // creator only
        assertEq(amt, 500);
    }

    // perpetual split
    function test_Perpetual_DeploysSplitter() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.Perpetual, 300));
        assertTrue(f.royaltySplit() != address(0));
        (address rcv,) = f.royaltyInfo(1, 10_000);
        assertEq(rcv, f.royaltySplit());
    }

    function test_Perpetual_TotalRoyaltyIsSum() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.Perpetual, 300));
        (, uint256 amt) = f.royaltyInfo(1, 10_000);
        assertEq(amt, 500 + 300); // royaltyBps + devBps
    }

    function test_Perpetual_RejectsRoyaltyTooHigh() public {
        CloneForge.Config memory c = _supportConfig(CloneForge.SupportMode.Perpetual, 500);
        c.royaltyBps = 600; // 600 + 500 = 1100 > 1000
        vm.expectRevert(CloneForge.RoyaltyTooHigh.selector);
        _deploy(c);
    }

    function test_Perpetual_RoyaltyLocked() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.Perpetual, 300));
        vm.prank(owner);
        vm.expectRevert(CloneForge.RoyaltyLocked.selector);
        f.setDefaultRoyalty(owner, 100);
    }

    function test_Perpetual_PrimaryRevenueAllOwner() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.Perpetual, 300));
        vm.prank(stranger);
        f.mintDrop{value: 0.02 ether}(2);
        assertEq(f.devAccrued(), 0);
        uint256 before = owner.balance;
        vm.prank(owner);
        f.withdraw(payable(owner));
        assertEq(owner.balance, before + 0.02 ether); // full balance to owner
    }

    // cross-cutting
    function test_OnlyOwner_Withdraw() public {
        vm.prank(stranger);
        vm.expectRevert();
        forge_.withdraw(payable(stranger));
    }

    function test_WithdrawDev_AnyoneCanTrigger_FundsGoToDev() public {
        CloneForge f = _deploy(_supportConfig(CloneForge.SupportMode.FirstSale, 300));
        vm.prank(stranger);
        f.mintDrop{value: 0.01 ether}(1);
        uint256 dev = f.devAccrued();
        uint256 before = developer.balance;
        vm.prank(stranger); // a stranger triggers the pull
        f.withdrawDev();
        assertEq(developer.balance, before + dev); // funds land at developer regardless
    }

    function test_SupportsInterface_2981_4906_Unchanged() public view {
        assertTrue(forge_.supportsInterface(0x49064906)); // ERC-4906
        assertTrue(forge_.supportsInterface(0x2a55205a)); // ERC-2981
        assertTrue(forge_.supportsInterface(0x80ac58cd)); // ERC-721
    }
}
