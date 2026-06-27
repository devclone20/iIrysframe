# ICloneAgent — the iNFT contract

The agent NFT for CLONE FRAME on **Base**. Each token *is* the agent, the key, and the vault:

- **ERC-721A** — gas-efficient, sequential tokenIds (start at 1).
- **Per-token Irys `tokenURI`** — the mint link sealed in iIrys Frame (`mint(to, uri)`), updatable via `setTokenURI` for evolving art.
- **ERC-2981 royalties** — perpetual 5% (configurable) to the treasury, honoured by Base marketplaces.
- **ERC-6551** — `tokenAccount(tokenId)` / `createTokenAccount(tokenId)` give each NFT a token-bound wallet (the canonical registry, identical on every chain).
- **Hardened** — `Ownable2Step`, `Pausable`, `ReentrancyGuard`, custom errors, zero-address/supply/payment checks, configurable mint gating.

Stack: Foundry · OpenZeppelin v5 · ERC721A v4.

## Mint authorisation

| state | who can mint | pays |
|---|---|---|
| default | owner + addresses in `minters` | free |
| `setPublicMint(true)` | anyone | `mintPrice` (0 by default) |

`mint(address,string)` matches what iIrys Frame's `web/src/mint.ts` calls. To let creators mint their own agents from iIrys Frame, either add them via `setMinter(addr,true)` or `setPublicMint(true)`.

## Test

```bash
forge test -vv          # 21 tests incl. royalty fuzz
forge coverage          # optional
```

## Deploy

```bash
cp .env.example .env     # fill PRIVATE_KEY, BASESCAN_API_KEY, treasury…

# 1) Test on Base Sepolia first (free testnet ETH from a Base Sepolia faucet)
forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast --verify

# 2) Then Base mainnet
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
```

The script prints the deployed address. Then:

1. Put it in **`web/.env`** → `VITE_MINT_CONTRACT=0x…` and restart iIrys Frame — the **Mint on Base** button goes live.
2. Enable minting from iIrys Frame: `cast send <addr> "setPublicMint(bool)" true` **or** `cast send <addr> "setMinter(address,bool)" <creator> true`.
3. (optional) `setMintPrice`, `setMaxSupply`.

> **Before relying on ERC-6551**, verify the current Tokenbound account implementation for Base and, if needed, `setImplementation(addr)`. The registry address is canonical and needs no change.

## Verified locally

Deployed to a local Anvil chain and exercised end-to-end: `mint(to, "https://gateway.irys.xyz/…")` → `tokenURI` returns the Irys link, `royaltyInfo(id, 10000)` returns `(treasury, 500)` = 5%, `supportsInterface(0x2a55205a)` (ERC-2981) = true. (`tokenAccount` needs the real 6551 registry, which exists on Base, not on a bare local chain — it's unit-tested with a mock.)
