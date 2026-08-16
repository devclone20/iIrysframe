#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
#  iIrys Frame — duplo-clique para abrir.
#  Arranca o servidor local e abre o iIrys Frame numa janela Google Chrome
#  dedicada (modo app, sem barras).
#  Fecha esta janela do Terminal para parar.
# ─────────────────────────────────────────────────────────────────────────────
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.foundry/bin:$PATH"

# Resolve a pasta web robustamente: usa a primeira candidata que tenha package.json.
# A primeira é relativa a este ficheiro — o launcher vive dentro da app, por isso
# a app pode mudar de sítio sem partir o duplo-clique.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
WEB=""
for W in \
  "$HERE/web" \
  "$HOME/Desktop/iIrysFrame/web" \
  "$HOME/Desktop/iFRAME/apps/iIrysframe/web"; do
  [ -f "$W/package.json" ] && WEB="$W" && break
done
# localhost (NÃO 127.0.0.1) — o Privy permite a origem localhost; em 127.0.0.1 o login da carteira é recusado.
URL="http://localhost:5173"
CONF="$HOME/.iirysframe"

# ── janela de app Chromium ────────────────────────────────────────────────────
# Procura um browser Chromium (Google Chrome primeiro — o mesmo padrão do
# CLONE FRAME HUB) e abre o iIrys Frame numa janela --app dedicada, com perfil
# próprio em ~/.iirysframe/chrome: nunca se mistura com o browsing normal nem
# com o perfil do CLONE FRAME, e os dois apps correm lado a lado sem conflito.
# Sem Chromium nenhum instalado → browser por omissão, com aviso.
open_app () {
  local cand CHROME_APP=""
  for cand in \
    "/Applications/Google Chrome.app" \
    "$HOME/Applications/Google Chrome.app" \
    "/Applications/Chromium.app" \
    "$HOME/Applications/Chromium.app" \
    "/Applications/Brave Browser.app" \
    "$HOME/Applications/Brave Browser.app" \
    "/Applications/Microsoft Edge.app" \
    "$HOME/Applications/Microsoft Edge.app" \
    "/Applications/Arc.app" \
    "$HOME/Applications/Arc.app" ; do
    [ -d "$cand" ] && { CHROME_APP="$cand"; break; }
  done
  if [ -n "$CHROME_APP" ]; then
    # O Privy autentica dentro de um iframe embebido: com cookies de terceiros
    # bloqueados (o default de um perfil novo) o login entra em loop. Semear o
    # pref uma vez chega — idempotente, mesmo fix do CLONE FRAME HUB.
    mkdir -p "$CONF/chrome/Default"
    if command -v node >/dev/null 2>&1; then
      node -e 'const f=process.argv[1],fs=require("fs");let j={};try{j=JSON.parse(fs.readFileSync(f,"utf8"))}catch{}j.profile=j.profile||{};if(j.profile.cookie_controls_mode!==0){j.profile.cookie_controls_mode=0;fs.writeFileSync(f,JSON.stringify(j))}' "$CONF/chrome/Default/Preferences" 2>/dev/null || true
    fi
    /usr/bin/open -na "$CHROME_APP" --args \
      --app="$URL" \
      --user-data-dir="$CONF/chrome" \
      --no-first-run --no-default-browser-check
  else
    echo "✗ Nenhum browser Chromium encontrado — a abrir no browser por omissão."
    echo "  Instala o Google Chrome para a experiência de app completa."
    /usr/bin/open "$URL"
  fi
}

clear
echo "◈  iIrys Frame"
echo "   NFT layer vault · Irys × Base"
echo ""

# ── modo release: o download traz web/dist já construído e SEM código-fonte ──
# Servir os ficheiros estáticos evita npm install e vite na máquina de quem
# descarrega — duplo-clique e está a correr. (A origem continua a ser
# http://localhost:5173, que é o que o Privy exige para o login.)
if [ -f "$WEB/dist/index.html" ] && [ ! -d "$WEB/src" ]; then
  if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
    echo "✓ iIrys Frame já está a correr — a abrir a janela Chrome…"
    open_app
    echo ""; read -r -p "Já está aberto. Carrega Enter para fechar esta janela…" _; exit 0
  fi
  SERVE=""
  command -v python3 >/dev/null 2>&1 && SERVE="python3"
  if [ -z "$SERVE" ] && ! command -v npx >/dev/null 2>&1; then
    echo "✗ Preciso do python3 (vem com o macOS) ou do Node para servir a app."
    echo ""; read -r -p "Carrega Enter para fechar…" _; exit 1
  fi
  echo "→ A arrancar o iIrys Frame… abre sozinho numa janela Chrome em segundos."
  echo "   (deixa esta janela aberta enquanto usas)"
  echo ""
  ( for _ in $(seq 1 40); do curl -s --max-time 1 "$URL" >/dev/null 2>&1 && { open_app; break; }; sleep 1; done ) &
  if [ "$SERVE" = "python3" ]; then
    exec python3 -m http.server 5173 --bind 127.0.0.1 --directory "$WEB/dist"
  else
    exec npx --yes serve -l 5173 -s "$WEB/dist"
  fi
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "✗ Node/npm não encontrado. Instala o Node (https://nodejs.org) e tenta de novo."
  echo ""; read -r -p "Carrega Enter para fechar…" _; exit 1
fi

cd "$WEB" 2>/dev/null || {
  echo "✗ Pasta web não encontrada. Tentei:"
  echo "   • $HERE/web  (ao lado deste ficheiro)"
  echo "   • ~/Desktop/iIrysFrame/web"
  echo "   • ~/Desktop/iFRAME/apps/iIrysframe/web"
  echo ""; read -r -p "Carrega Enter para fechar…" _; exit 1
}

if [ ! -d node_modules ]; then
  echo "→ Primeira vez: a instalar dependências (1-2 min)…"
  npm install || { echo "✗ Falhou o npm install."; read -r -p "Enter para fechar…" _; exit 1; }
  echo ""
fi

# Já está a correr? Abre só a janela de app.
if curl -s --max-time 2 "$URL" >/dev/null 2>&1; then
  echo "✓ iIrys Frame já está a correr — a abrir a janela Chrome…"
  open_app
  echo ""; read -r -p "Já está aberto. Carrega Enter para fechar esta janela…" _; exit 0
fi

echo "→ A arrancar o iIrys Frame… abre sozinho numa janela Chrome em segundos."
echo "   (deixa esta janela aberta enquanto usas)"
echo ""

# Abre a janela de app assim que o servidor responder.
( for _ in $(seq 1 40); do curl -s --max-time 1 "$URL" >/dev/null 2>&1 && { open_app; break; }; sleep 1; done ) &

npm run dev -- --host localhost --port 5173 --strictPort
