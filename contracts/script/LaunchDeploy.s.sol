// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ICloneAgent} from "../src/ICloneAgent.sol";

/**
 * Launch deploy for the iCLONE 1111 allowlist drop. One transaction bundle that
 * leaves ZERO launch config to remember later — the dossier's checklist, asserted:
 *
 *   maxSupply == 1111 (never the 0 = unlimited default)
 *   mintSigner set (dedicated key, NOT the deployer)
 *   phase 1 (allowlist) + phase 2 (public) windows
 *   contractURI (ERC-7572 collection metadata on Irys)
 *   publicMint stays false — every mint path is signer-gated
 *
 * Env: PRIVATE_KEY, MINT_SIGNER, PHASE1_START, PHASE1_END, PHASE2_START,
 *      CONTRACT_URI, plus Deploy.s.sol's NFT_ / ROYALTY_ / ERC6551_ vars.
 *
 *   forge script script/LaunchDeploy.s.sol --rpc-url base_sepolia --broadcast
 */
contract LaunchDeploy is Script {
    address constant DEFAULT_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    address constant DEFAULT_IMPLEMENTATION = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    uint256 constant SUPPLY = 1111;

    struct LaunchConfig {
        uint256 pk;
        address mintSigner;
        uint64 p1s;
        uint64 p1e;
        uint64 p2s;
        string contractUri;
    }

    function _config() internal view returns (LaunchConfig memory c) {
        c.pk = vm.envUint("PRIVATE_KEY");
        c.mintSigner = vm.envAddress("MINT_SIGNER");
        require(c.mintSigner != vm.addr(c.pk), "signer must be a dedicated key, not the deployer");
        c.p1s = uint64(vm.envUint("PHASE1_START"));
        c.p1e = uint64(vm.envUint("PHASE1_END"));
        c.p2s = uint64(vm.envUint("PHASE2_START"));
        c.contractUri = vm.envOr("CONTRACT_URI", string(""));
    }

    function _deployBase(uint256 pk) internal returns (ICloneAgent agent) {
        address deployer = vm.addr(pk);
        agent = new ICloneAgent(
            vm.envOr("NFT_NAME", string("iCLONE Agent")),
            vm.envOr("NFT_SYMBOL", string("INFT")),
            vm.envOr("NFT_OWNER", deployer),
            vm.envOr("ROYALTY_RECEIVER", deployer),
            uint96(vm.envOr("ROYALTY_BPS", uint256(500))),
            vm.envOr("ERC6551_REGISTRY", DEFAULT_REGISTRY),
            vm.envOr("ERC6551_IMPLEMENTATION", DEFAULT_IMPLEMENTATION)
        );
    }

    function run() external returns (ICloneAgent agent) {
        LaunchConfig memory c = _config();

        vm.startBroadcast(c.pk);
        agent = _deployBase(c.pk);
        agent.setMaxSupply(SUPPLY);
        agent.setMintSigner(c.mintSigner);
        agent.setPhase(1, c.p1s, c.p1e);
        agent.setPhase(2, c.p2s, 0);
        if (bytes(c.contractUri).length > 0) agent.setContractURI(c.contractUri);
        vm.stopBroadcast();

        // the asserts ARE the launch checklist — a deploy that passes is configured
        require(agent.maxSupply() == SUPPLY, "maxSupply not 1111");
        require(agent.mintSigner() == c.mintSigner, "signer not set");
        require(!agent.publicMint(), "publicMint must stay off");
        (uint64 s1,) = agent.phases(1);
        (uint64 s2,) = agent.phases(2);
        require(s1 != 0 && s2 != 0, "phases not configured");

        console2.log("ICloneAgent (launch) deployed:", address(agent));
        console2.log("  maxSupply :", agent.maxSupply());
        console2.log("  signer    :", agent.mintSigner());
        console2.log("  phase1    :", c.p1s, c.p1e);
        console2.log("  phase2    :", c.p2s);
    }
}
