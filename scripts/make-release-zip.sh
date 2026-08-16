#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  make-release-zip.sh — build the double-clickable iIrys Frame download.
#
#  Produces, in dist-release/:
#    iIrys-Frame-<version>.zip   the app: double-click launcher + built web/
#    SHA256SUMS.txt              checksum of the zip
#
#  The zip is self-contained apart from Node: it ships web/dist (already built)
#  and the launcher serves it. No npm install on the user's machine.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

VERSION="$(node -p "require('./web/package.json').version")"
OUT="dist-release"
STAGE="$OUT/iIrys Frame"

echo "▸ iIrys Frame v$VERSION"

# ── 1 · build the web app ────────────────────────────────────────────────────
echo "▸ building web/…"
(cd web && npm run build >/dev/null)
[ -f web/dist/index.html ] || { echo "✗ web/dist/index.html missing — build failed"; exit 1; }

# ── 2 · stage ────────────────────────────────────────────────────────────────
rm -rf "$OUT"
mkdir -p "$STAGE"

cp "iIrys Frame.command" "$STAGE/"
chmod +x "$STAGE/iIrys Frame.command"
cp -R "iIrys Frame.app" "$STAGE/" 2>/dev/null || true

mkdir -p "$STAGE/web"
# ONLY the built output — the launcher detects the absence of web/src and
# serves these files statically, so the download needs no npm install.
cp -R web/dist "$STAGE/web/dist"
[ -f web/.env.example ] && cp web/.env.example "$STAGE/web/"

cp README.md LICENSE "$STAGE/" 2>/dev/null || true

cat > "$STAGE/LEIA-ME.txt" <<'TXT'
iIrys Frame — app

ABRIR
  Duplo-clique em "iIrys Frame.command" (ou em "iIrys Frame.app").
  Abre uma janela dedicada do Chrome com a app. Fecha o Terminal para parar.

  Na primeira vez o macOS pode dizer que o ficheiro veio da internet:
  botão direito → Abrir → Abrir.

PRECISA
  Node.js 18+ (nodejs.org) e o Google Chrome (ou Chromium/Brave/Edge/Arc).

LOGIN
  A app pede um Privy App ID (grátis em dashboard.privy.io) na primeira
  utilização; guarda-o em web/.env como VITE_PRIVY_APP_ID e reabre.

O QUE FAZ
  Sela arte + metadados para sempre na Irys, paga a partir da tua carteira em
  Base ETH, e dá-te o tokenURI (mint link) — 2D ou 3D animado, item único ou
  colecção inteira, com contrato ERC-721 opcional numa transacção.
TXT

# ── 3 · zip + checksum ───────────────────────────────────────────────────────
ZIP="iIrys-Frame-$VERSION.zip"
(cd "$OUT" && zip -qry "$ZIP" "iIrys Frame")
(cd "$OUT" && shasum -a 256 "$ZIP" > SHA256SUMS.txt)

echo "▸ $OUT/$ZIP"
cat "$OUT/SHA256SUMS.txt"
echo "✓ done"
