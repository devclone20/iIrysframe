// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {ICloneAgent} from "../src/ICloneAgent.sol";

/**
 * Deploy ICloneAgent.
 *
 *   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify
 *   forge script script/Deploy.s.sol --rpc-url base         --broadcast --verify
 *
 * Reads from env (see .env.example). Sensible defaults when unset.
 */
contract Deploy is Script {
    // Canonical ERC-6551 registry — identical on every chain incl. Base.
    address constant DEFAULT_REGISTRY = 0x000000006551c19487814612e58FE06813775758;
    // Tokenbound default account implementation (v0.3.1). Verify for Base and
    // override via ERC6551_IMPLEMENTATION / setImplementation() if it changes.
    address constant DEFAULT_IMPLEMENTATION = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;

    function run() external returns (ICloneAgent agent) {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        string memory name = vm.envOr("NFT_NAME", string("iCLONE Agent"));
        string memory symbol = vm.envOr("NFT_SYMBOL", string("INFT"));
        address owner = vm.envOr("NFT_OWNER", deployer);
        address royaltyReceiver = vm.envOr("ROYALTY_RECEIVER", deployer);
        uint96 royaltyBps = uint96(vm.envOr("ROYALTY_BPS", uint256(500))); // 5%
        address registry = vm.envOr("ERC6551_REGISTRY", DEFAULT_REGISTRY);
        address implementation = vm.envOr("ERC6551_IMPLEMENTATION", DEFAULT_IMPLEMENTATION);

        vm.startBroadcast(pk);
        agent = new ICloneAgent(name, symbol, owner, royaltyReceiver, royaltyBps, registry, implementation);
        vm.stopBroadcast();

        console2.log("ICloneAgent deployed:", address(agent));
        console2.log("  owner           :", owner);
        console2.log("  royaltyReceiver :", royaltyReceiver);
        console2.log("  royaltyBps      :", royaltyBps);
        console2.log("  registry (6551) :", registry);
        console2.log("Set VITE_MINT_CONTRACT in web/.env to this address to enable the Mint button.");
    }
}
