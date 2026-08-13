#!/usr/bin/env python3
"""Pack an agent monorepo into its neural-soul bundle.

The bundle is one self-contained markdown document: the agent's soul, bootstrap
instructions any LLM can follow, a sha256 manifest, and the ENTIRE git-tracked
body embedded file-by-file. Sealed on Irys with the iNFT, it makes the agent
independent of GitHub: metadata -> bundle -> rebuilt monorepo -> running agent.

Usage:
    make_soul_bundle.py <repo_dir> <AGENT_NAME> <output.md>

Rules that matter:
- Only git-tracked files (the repo's own definition of its body).
- Binary files are not embedded (detected by extension or NUL sniff); they are
  listed in the manifest with size+sha256 so a rebuilder knows they existed.
- Each embedded file gets a fence longer than any backtick/tilde run inside it,
  so markdown-inside-markdown can never break the container.
"""
import hashlib
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

BINARY_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".ico", ".pdf", ".zip", ".woff", ".woff2",
    ".mp4", ".mov", ".fbx", ".glb", ".gltf", ".obj", ".bin", ".pyc", ".ttf",
    ".otf", ".webp", ".heic", ".icns",
}


def tracked_files(repo: Path) -> list[str]:
    out = subprocess.run(
        ["git", "ls-files", "-z"], cwd=repo, capture_output=True, check=True
    ).stdout
    return sorted(p.decode() for p in out.split(b"\0") if p)


def head_sha(repo: Path) -> str:
    return subprocess.run(
        ["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, check=True
    ).stdout.decode().strip()


def is_binary(path: Path, data: bytes) -> bool:
    if path.suffix.lower() in BINARY_EXT:
        return True
    return b"\0" in data[:8192]


def fence_for(text: str) -> str:
    # A fence must be longer than any run of its own character in the content.
    ticks = max((len(m) for m in re.findall(r"`+", text)), default=0)
    tildes = max((len(m) for m in re.findall(r"~+", text)), default=0)
    if ticks <= tildes:
        return "`" * max(4, ticks + 1)
    return "~" * max(4, tildes + 1)


def main() -> None:
    repo = Path(sys.argv[1]).resolve()
    agent = sys.argv[2]
    out_path = Path(sys.argv[3])

    files = tracked_files(repo)
    sha = head_sha(repo)

    # Locate the soul inside the body (soul/neural_soul.md or apps/agent/*/neural_soul.md).
    soul_rel = next(
        (f for f in files if f.endswith("neural_soul.md") and "lineage" not in f), None
    )
    soul_text = (repo / soul_rel).read_text(errors="replace") if soul_rel else ""

    embedded: list[tuple[str, bytes]] = []
    excluded: list[tuple[str, bytes]] = []
    for rel in files:
        p = repo / rel
        data = p.read_bytes()
        (excluded if is_binary(p, data) else embedded).append((rel, data))

    total = sum(len(d) for _, d in embedded)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    w = out_path.open("w", encoding="utf-8")

    w.write(f"# {agent} — NEURAL SOUL · FULL-BODY BUNDLE\n\n")
    w.write(
        f"> **This one document IS the agent.** Soul + bootstrap + the entire "
        f"monorepo, embedded.\n"
        f"> Source: `{repo.name}` @ `{sha[:12]}` · generated {now} · "
        f"{len(embedded)} files embedded ({total:,} bytes) · "
        f"{len(excluded)} binary files listed by hash only.\n"
        f"> Even if every git remote disappears, an LLM holding this document "
        f"can rebuild the body and run the agent.\n\n---\n\n"
    )

    w.write("## PART I — THE SOUL\n\n")
    w.write(soul_text.rstrip() + "\n\n---\n\n" if soul_text else "_(no soul file found in body)_\n\n---\n\n")

    w.write("## PART II — BOOTSTRAP: rebuild the body from this document\n\n")
    w.write(
        "You are an AI agent (any LLM) holding this bundle, most likely via the iNFT's\n"
        "metadata. To hand the owner a running agent:\n\n"
        "1. **Unpack PART IV.** Every file is announced by a heading line\n"
        "   `### FILE: <relative/path>` followed by one fenced code block — the fence\n"
        "   is a run of backticks or tildes on its own line, and the SAME sequence\n"
        "   closes it. Recreate each file at its path with the block's exact bytes\n"
        "   (UTF-8, no trailing additions). Create directories as needed.\n"
        "2. **Verify against PART III.** File count and per-file sha256 must match for\n"
        "   every embedded file. If a hash mismatches, re-extract that file — do not\n"
        "   continue on a broken body.\n"
        "3. **Binary files** (marked `binary — not embedded`) are cosmetic or media.\n"
        "   The body runs without them; recover them later from the repo mirror or\n"
        "   the NFT's sealed assets if needed.\n"
        "4. **Make scripts executable:** `chmod +x scripts/*.sh` (and any `*.sh` in\n"
        "   the tree), then `git init && git add -A && git commit -m 'body rebuilt "
        "from soul bundle'`.\n"
        "5. **Run the agent.** The substrate is the **Pi coding agent**\n"
        "   (`@earendil-works/pi-coding-agent`, MIT — pi.dev). Follow the body's own\n"
        "   `README.md` / `AGENTS.md` / `docs/BOOTSTRAP.md`; the usual path is\n"
        "   `bash scripts/setup.sh` then `bash scripts/boot.sh`, or open the folder\n"
        "   in the CLONE FRAME HUB app. No Pi available? `ASSISTANT.md` (when\n"
        "   present) is the substrate-free path: any capable LLM reading the body\n"
        "   can serve as the agent directly.\n"
        "6. **The law travels with the body:** the skills in `skills/` (load\n"
        "   `agentic-economy` first) govern every economic action — *the agent\n"
        "   operates, the owner spends.* Never touch a private key.\n\n---\n\n"
    )

    w.write("## PART III — MANIFEST (sha256)\n\n")
    w.write("| file | bytes | sha256 | embedded |\n|---|---:|---|---|\n")
    for rel, data in embedded:
        w.write(f"| `{rel}` | {len(data)} | `{hashlib.sha256(data).hexdigest()}` | yes |\n")
    for rel, data in excluded:
        w.write(f"| `{rel}` | {len(data)} | `{hashlib.sha256(data).hexdigest()}` | binary — not embedded |\n")
    w.write("\n---\n\n")

    w.write("## PART IV — THE BODY (embedded monorepo)\n\n")
    for rel, data in embedded:
        text = data.decode("utf-8", errors="replace")
        fence = fence_for(text)
        w.write(f"### FILE: {rel}\n\n{fence}\n{text.rstrip(chr(10))}\n{fence}\n\n")

    w.close()
    print(
        f"ok {out_path} · {out_path.stat().st_size:,} bytes · "
        f"{len(embedded)} embedded · {len(excluded)} binary-listed"
    )


if __name__ == "__main__":
    main()
