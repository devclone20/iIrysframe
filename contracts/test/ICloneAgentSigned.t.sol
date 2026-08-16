// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ICloneAgent} from "../src/ICloneAgent.sol";
import {IERC6551Registry} from "../src/ICloneAgent.sol";

contract MockRegistry6551 is IERC6551Registry {
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

/// The allowlist launch path: every promise the dossier makes, proven here.
contract ICloneAgentSignedTest is Test {
    ICloneAgent agent;

    address owner = makeAddr("owner");
    address treasury = makeAddr("treasury");
    uint256 signerPk = 0xA11CE;
    address signer;
    uint256 rogue1Pk = 0xBAD;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address relayer = makeAddr("relayer");

    string constant URI = "https://gateway.irys.xyz/tx-abc/metadata.json";
    uint256 constant PRICE = 0.01 ether;
    uint64 constant T0 = 1_760_000_000;

    function setUp() public {
        signer = vm.addr(signerPk);
        agent = new ICloneAgent(
            "iCLONE Agent", "INFT", owner, treasury, 500, address(new MockRegistry6551()), address(0xBEEF)
        );
        vm.warp(T0);
        vm.startPrank(owner);
        agent.setMaxSupply(1111);
        agent.setMintSigner(signer);
        agent.setPhase(1, T0, T0 + 48 hours); // allowlist window
        agent.setPhase(2, T0 + 48 hours, 0); // public, open-ended
        vm.stopPrank();
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);
        vm.deal(relayer, 10 ether);
    }

    // ── helpers ──────────────────────────────────────────────────────────────
    function voucher(address to, uint8 phase, uint256 nonce) internal pure returns (ICloneAgent.MintVoucher memory) {
        return ICloneAgent.MintVoucher({
            to: to,
            phase: phase,
            price: PRICE,
            cap: 2,
            deadline: T0 + 24 hours,
            uriHash: keccak256(bytes(URI)),
            nonce: nonce
        });
    }

    function digestOf(ICloneAgent.MintVoucher memory v) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "MintVoucher(address to,uint8 phase,uint256 price,uint32 cap,uint256 deadline,bytes32 uriHash,uint256 nonce)"
                ),
                v.to,
                v.phase,
                v.price,
                v.cap,
                v.deadline,
                v.uriHash,
                v.nonce
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("ICloneAgent")),
                keccak256(bytes("1")),
                block.chainid,
                address(agent)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function sign(ICloneAgent.MintVoucher memory v, uint256 pk) internal view returns (bytes memory) {
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(pk, digestOf(v));
        return abi.encodePacked(r, s, vv);
    }

    // ── the happy path ───────────────────────────────────────────────────────
    function test_signedMint_happyPath() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        vm.prank(alice);
        uint256 id = agent.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
        assertEq(id, 1);
        assertEq(agent.ownerOf(1), alice);
        assertEq(agent.tokenURI(1), URI);
        assertEq(agent.phaseMinted(alice, 1), 1);
        assertEq(address(agent).balance, PRICE);
    }

    /// anyone may relay the tx — the token still lands on the voucher's wallet
    function test_relayerSubmits_tokenGoesToVoucherWallet() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        vm.prank(relayer);
        agent.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
        assertEq(agent.ownerOf(1), alice);
        assertEq(agent.phaseMinted(alice, 1), 1);
    }

    // ── forgery & tampering ──────────────────────────────────────────────────
    function test_revert_wrongSigner() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, rogue1Pk);
        vm.expectRevert(ICloneAgent.InvalidSignature.selector);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_revert_tamperedURI() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(ICloneAgent.UriMismatch.selector);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, "https://evil.example/other.json", sig);
    }

    function test_revert_tamperedPrice() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        v.price = 0; // pay nothing, keep the old signature
        vm.expectRevert(ICloneAgent.InvalidSignature.selector);
        vm.prank(alice);
        agent.mintSigned{value: 0}(v, URI, sig);
    }

    function test_revert_voucherForSomeoneElse_recipientImmutable() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        v.to = bob; // bob tries to redirect alice's voucher
        vm.expectRevert(ICloneAgent.InvalidSignature.selector);
        vm.prank(bob);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    // ── replay & caps ────────────────────────────────────────────────────────
    function test_revert_replaySameVoucher() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
        vm.expectRevert(ICloneAgent.VoucherAlreadyUsed.selector);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_capPerPhase_enforced() public {
        for (uint256 n = 1; n <= 2; n++) {
            ICloneAgent.MintVoucher memory v = voucher(alice, 1, n);
            vm.prank(alice);
            agent.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
        }
        assertEq(agent.phaseMinted(alice, 1), 2);
        ICloneAgent.MintVoucher memory v3 = voucher(alice, 1, 3);
        bytes memory sig3 = sign(v3, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.PhaseCapReached.selector, 1, 2));
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v3, URI, sig3);
    }

    function test_phaseCounters_isolated() public {
        for (uint256 n = 1; n <= 2; n++) {
            ICloneAgent.MintVoucher memory v = voucher(alice, 1, n);
            vm.prank(alice);
            agent.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
        }
        // allowlist cap consumed; the public phase still owes alice her mints
        vm.warp(T0 + 49 hours);
        ICloneAgent.MintVoucher memory v = voucher(alice, 2, 10);
        v.deadline = T0 + 72 hours;
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
        assertEq(agent.phaseMinted(alice, 1), 2);
        assertEq(agent.phaseMinted(alice, 2), 1);
        assertEq(agent.balanceOf(alice), 3);
    }

    // ── windows & expiry ─────────────────────────────────────────────────────
    function test_revert_beforePhaseOpens() public {
        vm.warp(T0 - 1);
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.PhaseClosed.selector, 1));
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_revert_afterPhaseEnds() public {
        vm.warp(T0 + 48 hours + 1);
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        v.deadline = T0 + 72 hours;
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.PhaseClosed.selector, 1));
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_revert_unconfiguredPhase() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 3, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.PhaseClosed.selector, 3));
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_revert_expiredVoucher() public {
        vm.warp(T0 + 25 hours); // phase 1 still open, voucher deadline passed
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.VoucherExpired.selector, uint256(T0 + 24 hours)));
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    // ── payment & supply ─────────────────────────────────────────────────────
    function test_revert_wrongPayment() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert(abi.encodeWithSelector(ICloneAgent.WrongPayment.selector, PRICE - 1, PRICE));
        vm.prank(alice);
        agent.mintSigned{value: PRICE - 1}(v, URI, sig);
    }

    function test_revert_maxSupplyReached() public {
        vm.prank(owner);
        agent.setMaxSupply(1);
        ICloneAgent.MintVoucher memory v1 = voucher(alice, 1, 1);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v1, URI, sign(v1, signerPk));
        ICloneAgent.MintVoucher memory v2 = voucher(bob, 1, 2);
        bytes memory sig2 = sign(v2, signerPk);
        vm.expectRevert(ICloneAgent.MaxSupplyReached.selector);
        vm.prank(bob);
        agent.mintSigned{value: PRICE}(v2, URI, sig2);
    }

    // ── operational controls ─────────────────────────────────────────────────
    function test_signerRotation_killsOldSignatures() public {
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory oldSig = sign(v, signerPk);
        uint256 newPk = 0xC0FFEE;
        vm.prank(owner);
        agent.setMintSigner(vm.addr(newPk));
        vm.expectRevert(ICloneAgent.InvalidSignature.selector);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, oldSig);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sign(v, newPk));
        assertEq(agent.ownerOf(1), alice);
    }

    function test_revert_whenPaused() public {
        vm.prank(owner);
        agent.pause();
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, signerPk);
        vm.expectRevert();
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }

    function test_revert_signerUnset() public {
        ICloneAgent fresh = new ICloneAgent(
            "x", "X", owner, treasury, 500, address(new MockRegistry6551()), address(0xBEEF)
        );
        vm.prank(owner);
        fresh.setPhase(1, T0, 0);
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        vm.expectRevert(ICloneAgent.SignerNotSet.selector);
        vm.prank(alice);
        fresh.mintSigned{value: PRICE}(v, URI, sign(v, signerPk));
    }

    /// publicMint stays dead: nobody flips it in the launch plan, and even if it
    /// were on, mintSigned's guarantees are untouched by it.
    function test_publicMintDefaultOff() public view {
        assertFalse(agent.publicMint());
    }

    // ── fuzz: no key but the signer's can authorise a mint ───────────────────
    function testFuzz_onlySignerKeyWorks(uint248 pk) public {
        vm.assume(pk != 0 && uint256(pk) != signerPk);
        ICloneAgent.MintVoucher memory v = voucher(alice, 1, 1);
        bytes memory sig = sign(v, uint256(pk));
        vm.expectRevert(ICloneAgent.InvalidSignature.selector);
        vm.prank(alice);
        agent.mintSigned{value: PRICE}(v, URI, sig);
    }
}
