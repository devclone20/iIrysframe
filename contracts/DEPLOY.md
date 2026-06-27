# Deploy do ICloneAgent — passo a passo

Dois caminhos. Faz **A (Sepolia)** primeiro para veres tudo a funcionar de graça; depois **B (mainnet)** quando estiveres confiante.

Os **argumentos do construtor** (iguais nos dois):

| # | argumento | valor | nota |
|---|---|---|---|
| 1 | `name_` | `iCLONE Agent` | nome da coleção |
| 2 | `symbol_` | `INFT` | símbolo |
| 3 | `owner_` | **o teu endereço** | admin do contrato |
| 4 | `royaltyReceiver_` | **o teu treasury** | recebe os 5% |
| 5 | `royaltyBps_` | `500` | 500 = 5% |
| 6 | `registry_` | `0x000000006551c19487814612e58FE06813775758` | ERC-6551 canónico (igual em todas as chains) |
| 7 | `implementation_` | `0x41C8f39463A868d3A88af00cd0fe7102F30E44eC` | impl Tokenbound (verifica p/ Base; dá para mudar depois com `setImplementation`) |

---

## A) Base Sepolia — GRÁTIS (Foundry CLI)

Testnet: o ETH é falso/grátis, **não gasta o teu Base ETH real**.

1. **Faucet.** Já gerei um deployer descartável; o endereço está no fim do `contracts/.env` setup. Vê-o com:
   ```bash
   cd ~/Desktop/AI/ivault/contracts
   source ~/.zshenv 2>/dev/null
   cast wallet address --private-key $(grep '^PRIVATE_KEY=' .env | cut -d= -f2)
   ```
   Envia ~**0.01 test ETH** para esse endereço a partir de um faucet Base Sepolia:
   - Coinbase CDP: https://portal.cdp.coinbase.com/products/faucet (escolhe **Base Sepolia**)
   - ou Alchemy: https://www.alchemy.com/faucets/base-sepolia

2. **Confirma o saldo:**
   ```bash
   cast balance $(cast wallet address --private-key $(grep '^PRIVATE_KEY=' .env | cut -d= -f2)) --rpc-url https://sepolia.base.org
   ```
   (≠ 0 → estás pronto)

3. **No `.env`** mete o teu treasury (senão usa o deployer):
   ```
   ROYALTY_RECEIVER=0xOTeuTreasury
   ```

4. **Deploy:**
   ```bash
   forge script script/Deploy.s.sol --rpc-url base_sepolia --broadcast
   ```
   Copia a linha `ICloneAgent deployed: 0x...`.

5. (Opcional) **Verifica no Basescan Sepolia** — precisa de `BASESCAN_API_KEY` no `.env`, depois acrescenta `--verify`.

→ Salta para **"Depois do deploy"** em baixo.

---

## B) Base mainnet — com a TUA carteira (Remix, sem CLI nem chave)

Custo real ≈ **uns cêntimos** (a Base é L2). Assinas tu na carteira; nenhuma chave sai do teu controlo.

1. Abre **https://remix.ethereum.org**.

2. No explorador de ficheiros (à esquerda), **New File** → chama-lhe `ICloneAgent.sol`.

3. Cola o conteúdo de **`contracts/flat/ICloneAgent.flat.sol`** (já está achatado, sem imports externos).
   - Abre o ficheiro: `~/Desktop/AI/ivault/contracts/flat/ICloneAgent.flat.sol` → copia tudo → cola no Remix.

4. **Solidity Compiler** (ícone à esquerda):
   - Compiler: **0.8.28** (ou ≥0.8.20).
   - Advanced → **Enable optimization**, runs **200**, EVM **cancun**.
   - **Compile**. (Pode aparecer um aviso de pragmas múltiplos — ignora, compila na mesma.)

5. **Deploy & Run Transactions** (ícone à esquerda):
   - **Environment** → **Injected Provider - MetaMask** (ou Coinbase). A carteira liga-se.
   - Confirma que a carteira está na rede **Base** (chainId **8453**). Se não, troca na carteira.
   - **Contract** → escolhe `ICloneAgent`.
   - Ao lado do botão **Deploy**, expande os campos do construtor e preenche os 7 argumentos da tabela acima (owner e treasury = os teus).
   - Clica **Deploy** → **confirma na carteira** (paga o gás em Base ETH).

6. Quando confirmar, em baixo aparece o contrato em **"Deployed Contracts"** — copia o endereço (ícone de copiar).

→ Continua em **"Depois do deploy"**.

---

## Depois do deploy (igual nos dois)

1. **Liga ao iIrys Frame.** Em `~/Desktop/AI/ivault/web/.env`:
   ```
   VITE_MINT_CONTRACT=0xOEndereçoDoContrato
   ```
   Reinicia o iIrys Frame (fecha/reabre o `iIrys Frame.command`). O botão **Mint on Base** fica ativo.

2. **Ativa o mint** (escolhe um):
   - **Público** (qualquer um cunha o seu agente):
     ```bash
     cast send <contrato> "setPublicMint(bool)" true --rpc-url <base|base_sepolia> --private-key <tua_chave>
     ```
   - **ou por allowlist** (só endereços teus):
     ```bash
     cast send <contrato> "setMinter(address,bool)" <criador> true ...
     ```
   - No Remix dá para chamar estas funções em "Deployed Contracts" sem CLI.

3. (Opcional) `setMintPrice(uint256 weiPrice)`, `setMaxSupply(uint256)`.

4. **Testa o mint** no iIrys Frame: sela uma metadata → **Mint on Base** → assina → o NFT aparece com `tokenURI` = o teu link Irys. 🎉

> **ERC-6551:** antes de usares as contas-cofre (`tokenAccount`), confirma a implementação Tokenbound atual para a Base e, se preciso, `setImplementation(novoEndereço)`. O registry é canónico, não muda.
