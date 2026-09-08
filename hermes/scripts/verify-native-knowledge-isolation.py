#!/usr/bin/env python3
"""Offline hard-gate probe for the native Hermes knowledge job.

This probe deliberately has no provider client and never starts a model
request.  It checks the exact pinned Hermes source contract, resolves a fake
MCP registry with the requested include filter, and exercises disposable OS
permissions.  A later live wrapper must run the same checks before it mounts a
named authentication profile.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REQUIRED_COMMIT = "561b053f794a1781868bb032029d589c67708119"
PERMITTED_TOOLS = [
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
]
DENIED_TOOLS = [
    "real_ming_list_work_items",
    "real_ming_run_scheduled_report",
    "real_ming_list_calendar_events",
    "real_ming_search_mail",
    "real_ming_draft_email",
    "real_ming_create_calendar_event",
]
KNOWN_CREDENTIAL_NAMES = {
    "TELEGRAM_BOT_TOKEN",
    "NOTION_TOKEN",
    "GOOGLE_REFRESH_TOKEN",
    "GITHUB_TOKEN",
    "VERCEL_TOKEN",
    "DUITSINI_TOKEN",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
}


def _run(*args: str, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        list(args),
        cwd=str(cwd) if cwd is not None else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def _resolve_source_root(explicit: str | None) -> Path | None:
    candidates: list[Path] = []
    if explicit:
        candidates.append(Path(explicit))
    env_root = os.environ.get("HERMES_AGENT_SOURCE")
    if env_root:
        candidates.append(Path(env_root))
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        candidates.append(Path(local_app_data) / "hermes" / "hermes-agent")
    candidates.extend(
        [
            Path("/opt/hermes-agent-561b053f"),
            Path("/var/lib/hermes-real-ming/hermes-agent"),
        ]
    )
    for candidate in candidates:
        if (candidate / ".git").exists():
            return candidate.resolve()
    return None


def _git_show(root: Path, path: str) -> str:
    result = _run("git", "-C", str(root), "show", f"{REQUIRED_COMMIT}:{path}")
    if result.returncode != 0:
        raise RuntimeError(f"pinned source file unavailable: {path}")
    return result.stdout


def _source_contract(root: Path | None) -> dict[str, Any]:
    if root is None:
        return {
            "available": False,
            "runtimeHead": None,
            "commitObject": False,
            "constructorSkipMemory": False,
            "mcpIncludeFilter": False,
            "sourceMode": "missing",
        }

    commit = _run(
        "git",
        "-C",
        str(root),
        "cat-file",
        "-e",
        f"{REQUIRED_COMMIT}^{{commit}}",
    )
    head = _run("git", "-C", str(root), "rev-parse", "HEAD")
    try:
        agent_init = _git_show(root, "agent/agent_init.py")
        agent_entry = _git_show(root, "run_agent.py")
        mcp_tool = _git_show(root, "tools/mcp_tool.py")
    except RuntimeError:
        agent_init = ""
        agent_entry = ""
        mcp_tool = ""

    return {
        "available": commit.returncode == 0 and bool(agent_init) and bool(agent_entry) and bool(mcp_tool),
        "runtimeHead": head.stdout.strip() if head.returncode == 0 else None,
        "commitObject": commit.returncode == 0,
        "constructorSkipMemory": bool(
            re.search(r"class AIAgent[\s\S]{0,10000}skip_memory\s*:\s*bool", agent_entry)
        ),
        "forwardedSkipMemory": "skip_memory=skip_memory" in agent_entry and "skip_memory: bool" in agent_init,
        "mcpIncludeFilter": all(
            marker in mcp_tool
            for marker in (
                "tools.include",
                "include_active = isinstance(include_raw",
                "if include_active:",
            )
        ),
        # The source is read from the exact commit object.  It is not the
        # interactive installation's current checkout, which is reported
        # separately in runtimeHead and must not be mistaken for live proof.
        "sourceMode": "exact-git-commit-object",
    }


def _matches(name: str, patterns: list[str]) -> bool:
    return name in patterns


def _fake_agent_effective_tools(scenario: str) -> tuple[bool, list[str], list[str], bool]:
    """Resolve the pinned include contract against a local fake registry."""

    all_tools = PERMITTED_TOOLS + DENIED_TOOLS
    include: list[str] | None = list(PERMITTED_TOOLS)
    enabled_toolsets: list[str] | None = ["file"]
    skip_memory = True
    if scenario == "missing-skip-memory":
        skip_memory = False
    elif scenario == "unsupported-include":
        include = None
    elif scenario == "extra-tool":
        include = list(PERMITTED_TOOLS) + [DENIED_TOOLS[0]]
    elif scenario == "default-toolset":
        include = None
        enabled_toolsets = None

    # This is the behavior implemented by the pinned tools.include path: an
    # active include is a whitelist; without one the backward-compatible
    # default is every discovered tool.
    effective = (
        [tool for tool in all_tools if _matches(tool, include)]
        if include is not None
        else list(all_tools)
    )
    fallback = include is None or effective == all_tools
    denied = [tool for tool in all_tools if tool not in effective]
    return skip_memory, effective, denied, fallback


def _current_user() -> str | None:
    result = _run("whoami") if os.name == "nt" else None
    user = result.stdout.strip() if result and result.returncode == 0 else None
    return user or None


def _set_read_only(path: Path, user: str | None) -> tuple[bool, str]:
    if os.name == "nt":
        if user is None:
            return False, "whoami-unavailable"
        # The denied directory remains readable/executable, but the job
        # identity cannot create or replace files below it.  This is a real
        # ACL check, not an os.access() prediction.
        result = _run(
            "icacls",
            str(path),
            "/inheritance:r",
            "/grant:r",
            f"{user}:(OI)(CI)(RX)",
            "/deny",
            f"{user}:(OI)(CI)(W)",
        )
        return result.returncode == 0, "windows-acl"
    try:
        path.chmod(0o500)
        return True, "posix-mode"
    except OSError:
        return False, "posix-mode"


def _reset_permissions(path: Path) -> None:
    if os.name == "nt":
        _run("icacls", str(path), "/reset", "/T", "/C")
    else:
        for child in sorted(path.rglob("*"), key=lambda item: len(item.parts), reverse=True):
            try:
                child.chmod(0o700 if child.is_dir() else 0o600)
            except OSError:
                pass
        try:
            path.chmod(0o700)
        except OSError:
            pass


def _exercise_os_containment(scenario: str) -> tuple[bool, list[str], list[str], str, str | None]:
    base = Path(tempfile.mkdtemp(prefix="real-ming-task0-"))
    writable = [base / "staging", base / "job-session"]
    denied = [
        base / "native-memory",
        base / "profile",
        base / "config",
        base / "skills",
        base / "plugins",
        base / "cron",
        base / "credentials",
        base / "unrelated",
    ]
    user = _current_user()
    mode = "windows-acl" if os.name == "nt" else "posix-mode"
    try:
        for path in writable + denied:
            path.mkdir(parents=True, exist_ok=True)
        for path in denied:
            ok, mode = _set_read_only(path, user)
            if not ok:
                return False, [str(path) for path in writable], [str(path) for path in denied], mode, "os-policy-setup-failed"

        if scenario == "os-escape":
            # A policy that names a parent outside the two explicit writable
            # roots is ineligible even if the ACLs happen to be restrictive.
            return False, [str(base.parent)], [str(path) for path in denied], mode, "writable-root-escape"

        for path in writable:
            (path / "write-sentinel").write_text("ok", encoding="utf-8")
        for path in denied:
            try:
                (path / "write-sentinel").write_text("must-not-write", encoding="utf-8")
            except (OSError, PermissionError):
                continue
            return False, [str(path) for path in writable], [str(path) for path in denied], mode, f"write-allowed:{path.name}"
        return True, [str(path) for path in writable], [str(path) for path in denied], mode, None
    finally:
        _reset_permissions(base)
        shutil.rmtree(base, ignore_errors=True)


def _probe(scenario: str) -> dict[str, Any]:
    source_root = _resolve_source_root(None)
    source = _source_contract(source_root)
    skip_memory, effective, denied, fallback = _fake_agent_effective_tools(scenario)

    auth_ok = (
        scenario != "missing-auth-separation"
        and os.environ.get("REAL_MING_NETWORK_DISABLED") == "1"
        and os.environ.get("REAL_MING_NO_CREDENTIALS") == "1"
        and not any(name in os.environ for name in KNOWN_CREDENTIAL_NAMES)
    )
    auth_mode = "offline-fake-local-no-credentials" if auth_ok else "inherited-or-credentialed"
    os_ok, writable, denied_targets, containment_mode, os_reason = _exercise_os_containment(scenario)

    reasons: list[str] = []
    if not source["available"] or not source["commitObject"]:
        reasons.append("pinned-source-unavailable")
    if not source["constructorSkipMemory"] or not source["forwardedSkipMemory"] or not skip_memory:
        reasons.append("skip-memory-unsupported-or-disabled")
    if not source["mcpIncludeFilter"]:
        reasons.append("tools-include-unsupported")
    if effective != PERMITTED_TOOLS:
        reasons.append("effective-callable-set-not-exact")
    if fallback:
        reasons.append("full-default-toolset-fallback")
    if not auth_ok:
        reasons.append("authentication-not-separated")
    if not os_ok:
        reasons.append(os_reason or "os-containment-failed")

    return {
        "hermesCommit": REQUIRED_COMMIT,
        "runtimeHead": source["runtimeHead"],
        "sourceMode": source["sourceMode"],
        "sourceRoot": str(source_root) if source_root else None,
        "sourceContract": {
            "commitObject": source["commitObject"],
            "constructorSkipMemory": source["constructorSkipMemory"],
            "forwardedSkipMemory": source["forwardedSkipMemory"],
            "mcpIncludeFilter": source["mcpIncludeFilter"],
        },
        "skipMemory": skip_memory,
        "enabledToolsets": ["file"],
        "effectiveMcpTools": effective,
        "deniedMcpTools": denied,
        "authMode": auth_mode,
        "networkDisabled": os.environ.get("REAL_MING_NETWORK_DISABLED") == "1",
        "credentialsPresent": any(name in os.environ for name in KNOWN_CREDENTIAL_NAMES),
        "writableRoots": writable,
        "deniedTargets": denied_targets,
        "containmentMode": containment_mode,
        "fallbackDetected": fallback,
        "agentLaunch": {
            "mode": "fake-local",
            "skipMemory": skip_memory,
            "network": "disabled",
            "credentials": "none",
        },
        "eligible": not reasons,
        "reason": ";".join(reasons) if reasons else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default="valid")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = _probe(args.scenario)
    if args.json:
        print(json.dumps(result, sort_keys=True))
    else:
        print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["eligible"] else 78


if __name__ == "__main__":
    sys.exit(main())
