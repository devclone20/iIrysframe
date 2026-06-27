#!/usr/bin/env python3
"""
Training — agent self-improvement pass for this repository.

Runs a panel of specialist agents (configured via TRAIN_AGENTS) over a bounded
snapshot of the repo and writes a single Markdown report to training_reports/
(uploaded as a CI artifact).

Design contract — this MUST be safe for a scheduled CI job:
  * No ANTHROPIC_API_KEY  -> print SKIP and exit 0 (the schedule stays green).
  * Any API / runtime error -> print WARN and exit 0 (never breaks the schedule).
  * Read-only to the repo: writes only under training_reports/.
"""
from __future__ import annotations

import datetime as dt
import os
import subprocess
import sys
from pathlib import Path

MODEL = os.environ.get("TRAIN_MODEL", "claude-sonnet-4-6")
REPO = os.environ.get("GITHUB_REPOSITORY", Path.cwd().name)
FOCUS = os.environ.get("TRAIN_FOCUS", "this repository")
AGENTS = [a.strip() for a in os.environ.get("TRAIN_AGENTS", "engineer").split(",") if a.strip()]
MAX_CONTEXT = 12000  # chars of repo snapshot sent to each agent

PERSONAS = {
    "engineer": "a world-class full-stack engineer. Review correctness, architecture, performance and type/security strictness.",
    "designer": "a world-class UI/UX designer (Linear/Stripe/Vercel/Apple bar, dark-first). Review hierarchy, typography, consistency and polish.",
    "architect": "a senior systems architect. Review structure, coupling, single points of failure and scalability.",
    "hacker": "a senior application-security engineer. Review for OWASP Top 10, secret hygiene and the client/server attack surface.",
    "qa": "a senior QA engineer. Review for edge cases, failure modes and missing test coverage.",
}


def sh(*args: str) -> str:
    try:
        return subprocess.run(args, capture_output=True, text=True, timeout=30).stdout
    except Exception:
        return ""


def snapshot() -> str:
    parts: list[str] = []
    readme = Path("README.md")
    if readme.exists():
        parts.append("# README.md\n" + readme.read_text(encoding="utf-8", errors="replace")[:6000])
    tree = sh("git", "ls-files")
    if tree:
        parts.append("# tracked files\n" + tree[:4000])
    return ("\n\n".join(parts))[:MAX_CONTEXT] or "(empty repository snapshot)"


def main() -> int:
    key = os.environ.get("ANTHROPIC_API_KEY", "").strip()
    if not key:
        print("SKIP - ANTHROPIC_API_KEY not set; nothing to train this run.")
        return 0

    try:
        import anthropic
    except Exception as e:
        print(f"WARN - anthropic SDK unavailable ({e}); skipping.")
        return 0

    client = anthropic.Anthropic(api_key=key)
    ctx = snapshot()
    today = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")
    sections: list[str] = []

    for agent in AGENTS:
        persona = PERSONAS.get(agent, PERSONAS["engineer"])
        system = (
            f"You are {persona} You are doing a periodic improvement review of the repository "
            f"'{REPO}'. Context: {FOCUS}. Be concrete and terse. Return at most 5 prioritized, "
            f"actionable improvements as a Markdown list - no preamble, no praise padding."
        )
        try:
            msg = client.messages.create(
                model=MODEL,
                max_tokens=900,
                system=system,
                messages=[
                    {"role": "user", "content": f"Repository snapshot:\n\n{ctx}\n\nGive your top improvements."}
                ],
            )
            text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text").strip()
        except Exception as e:
            text = f"_review skipped - {type(e).__name__}: {e}_"
        sections.append(f"## {agent.capitalize()}\n\n{text}\n")
        print(f". {agent}: done")

    out_dir = Path("training_reports")
    out_dir.mkdir(exist_ok=True)
    report = out_dir / f"REPORT-{today}.md"
    header = (
        f"# Training report - {REPO}\n\n"
        f"- date: {today} (UTC)\n- model: {MODEL}\n- agents: {', '.join(AGENTS)}\n\n"
        f"> Focus: {FOCUS}\n\n---\n\n"
    )
    report.write_text(header + "\n".join(sections), encoding="utf-8")
    print(f"OK - wrote {report}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # absolute safety net - never fail the schedule
        print(f"WARN - unexpected error ({type(e).__name__}: {e}); exiting clean.")
        sys.exit(0)
