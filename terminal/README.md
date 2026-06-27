# iIrys Frame — terminal (Irys CLI)

Do everything the web app does, from the shell — paid in **Base ETH**.

## Install (once)

```bash
npm i -g @irys/cli          # add sudo if your global npm needs it
irys price 51200 -t base-eth   # smoke test → prints a Base ETH price
```

> The CLI signs with a **private key** (`-w`), unlike the web app which uses your
> wallet. Keep the key in an env var, never in a file you commit:
> `export IRYS_KEY=0x...`

## Core commands (Base mainnet is the default network)

```bash
# What will it cost? (bytes)  — under 100 KiB is free
irys price 250000 -t base-eth

# Your Irys node balance
irys balance 0xYourAddress -t base-eth

# Top up the node from your Base wallet (amount in wei)
irys fund 100000000000000 -t base-eth -w "$IRYS_KEY"

# Upload one file → prints the gateway id/URL (the "key link")
irys upload art.png -t base-eth -w "$IRYS_KEY" \
  --tags App-Name "iIrys Frame" Type final Collection "iCLONE Genesis"

# Upload a whole folder (creates a manifest)
irys upload-dir ./layers -t base-eth -w "$IRYS_KEY" \
  --tags App-Name "iIrys Frame" Type layer

# Get unused balance back
irys withdraw 50000000000000 -t base-eth -w "$IRYS_KEY"
```

Retrieve anything at `https://gateway.irys.xyz/<id>` (mutable: `…/mutable/<id>`).

## Helper: seal a folder as one NFT's layers

`seal-layers.sh` wraps `upload-dir` with the same tags the web app writes, so
folders sealed from the terminal appear in the app's **Vault**:

```bash
chmod +x seal-layers.sh
export IRYS_KEY=0x...
./seal-layers.sh "~/Desktop/iNFT ideas_Images/my-nft" "iCLONE Genesis" iclone
```

## Tag model (so the app can group your uploads)

| tag | values |
|---|---|
| `App-Name` | `iIrys Frame` |
| `Type` | `layer` · `final` · `metadata` |
| `Item` | a shared id per NFT (the script uses `uuidgen`) |
| `Collection` / `Tier` | optional |

## Safety

- `export IRYS_KEY=...` per shell session; don't persist it in dotfiles you sync.
- Base mainnet = **real ETH**. Use `irys price` first; files <100 KiB are free.
