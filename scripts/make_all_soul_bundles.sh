#!/bin/bash
# Regenera os 3 soul-bundles (soul + monorepo inteiro embebido) para
# web/public/souls/. Correr SEMPRE que um monorepo de agente for actualizado —
# o soul no iIrys Frame é o espelho selável do monorepo ("se atualizarmos o
# Monorepo, vamos atualizar o Sol").
#
# iclone usa o checkout local do dono; vegeta e goku clonam frescos do GitHub
# (rasos, para /tmp) para o bundle reflectir exactamente o main publicado.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../web/public/souls"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

bundle() { python3 "$HERE/make_soul_bundle.py" "$1" "$2" "$OUT/neural_soul-$3.md"; }

if [ -d "$HOME/Desktop/AI/iclone/.git" ]; then
  ICLONE="$HOME/Desktop/AI/iclone"
else
  git clone -q --depth 1 https://github.com/devclone20/iclone.git "$TMP/iclone"; ICLONE="$TMP/iclone"
fi
git clone -q --depth 1 https://github.com/devclone20/vegeta.git "$TMP/vegeta"
git clone -q --depth 1 https://github.com/devclone20/goku.git "$TMP/goku"

bundle "$ICLONE" ICLONE iclone
bundle "$TMP/vegeta" VEGETA vegeta
bundle "$TMP/goku" GOKU goku
echo "✓ 3 bundles regenerados em web/public/souls/"
