# Security Policy

iIrys Frame moves money (it funds Irys and signs transactions on Base). Treat
keys accordingly.

## Reporting a vulnerability

**Do not open a public issue for security problems.** Use GitHub's private
**"Report a vulnerability"** flow on this repository
(*Security → Advisories → Report a vulnerability*). We aim to respond within 72h.

## Secrets — never commit them

This repo is sterilized: no private keys, no `.env`, no wallet material is
tracked. The following are **gitignored** and must never be committed:

- `.env` (any) — only `.env.example` (placeholders) is tracked.
- `data/`, `*.key`, `*.pem`, `*.keystore`, keystores, mnemonics.
- build artifacts: `node_modules/`, `dist/`, `web/dist/`,
  `contracts/{out,cache,broadcast,lib}/`.

Before any commit, verify nothing sensitive is staged:

```bash
git status --porcelain          # nothing under .env / data / keys
git diff --cached | grep -iE '0x[a-f0-9]{64}|PRIVATE_KEY=.|sk-|ghp_|-----BEGIN' || echo "clean"
```

A pre-publication scan (secrets, git history) with tools like
[`gitleaks`](https://github.com/gitleaks/gitleaks) or
[`trufflehog`](https://github.com/trufflesecurity/trufflehog) is recommended in
CI before going public.

## Key handling by surface

| Surface | Key custody |
|---|---|
| `web/` | **No key in the bundle.** Users sign with their own wallet via Privy; the only client value is the public `VITE_PRIVY_APP_ID`. |
| `src/` (v1 server) | `PRIVATE_KEY` lives **only** in server-side `.env`, never returned to the client. The server binds `127.0.0.1`, caps funding with `FUND_MAX_ETH`, and can gate writes with `VAULT_TOKEN`. |
| `contracts/` | Deployer `PRIVATE_KEY` only in `.env`, used locally by Foundry for deploys. Never hardcode it in scripts. |
| `terminal/` | `@irys/cli` reads the key from your environment / `-w`; keep it out of shell history. |

## On-chain values that are *not* secrets

Deployed contract addresses (e.g. the Base `ICloneAgent`), the canonical
ERC-6551 registry/implementation, and the public `VITE_PRIVY_APP_ID` are public
by design and safe to share.
