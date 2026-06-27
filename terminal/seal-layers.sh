#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  seal-layers.sh — seal a folder of NFT layers to Irys, paid in Base ETH,
#  tagged exactly like the iIrys Frame web app so they show up in your Vault.
#
#  Usage:
#    export IRYS_KEY=0x<your Base private key>      # never commit this
#    ./seal-layers.sh <folder> [collection] [tier]
#
#  Each run treats the folder as ONE item's layers (shared Item id). Run once
#  per NFT. For a single file use `irys upload` (see terminal/README.md).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DIR="${1:?usage: seal-layers.sh <folder> [collection] [tier]}"
COLLECTION="${2:-}"
TIER="${3:-}"

: "${IRYS_KEY:?set IRYS_KEY to your Base private key, e.g. export IRYS_KEY=0x...}"
command -v irys >/dev/null || { echo "Irys CLI not found. Run: npm i -g @irys/cli"; exit 1; }
[ -d "$DIR" ] || { echo "Not a folder: $DIR"; exit 1; }

ITEM="$(uuidgen)"
TAGS=(App-Name "iIrys Frame" Type layer Item "$ITEM")
[ -n "$COLLECTION" ] && TAGS+=(Collection "$COLLECTION")
[ -n "$TIER" ] && TAGS+=(Tier "$TIER")

echo "◈ Sealing layers in '$DIR'"
echo "   item: $ITEM   collection: ${COLLECTION:-—}   tier: ${TIER:-—}"
echo "   network: Base mainnet (paid in Base ETH; files <100 KiB are free)"
echo

irys upload-dir "$DIR" -t base-eth -w "$IRYS_KEY" -n mainnet --tags "${TAGS[@]}"

echo
echo "✓ Done. Open the iIrys Frame app (web/) and your wallet to see these under Item $ITEM."
