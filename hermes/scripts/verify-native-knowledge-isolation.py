#!/usr/bin/env python3
"""Fail-closed, network-free proof of the native Hermes job boundary.

The probe intentionally loads the exact pinned Hermes source from a git
object into a disposable import root and asks the real ``AIAgent`` constructor
for its tool definitions. A local in-memory MCP server is registered through
Hermes' own ``_register_server_tools`` path; it is never connected and no
provider request is made. The resulting report is a compatibility probe, not
live acceptance.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path
from types import SimpleNamespace
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
    "LLM_API_KEY",
    "ZAI_API_KEY",
}
MCP_PREFIX = "mcp__real_ming__"
PINNED_SOURCE_PATHS = (
    "run_agent.py",
    "model_tools.py",
    "toolsets.py",
    "hermes_constants.py",
    "utils.py",
    "agent",
    "tools",
    "hermes_cli",
    "providers",
)


def _run(*args: str, cwd: Path | None = None, input_bytes: bytes | None = None) -> subprocess.CompletedProcess[Any]:
    return subprocess.run(
        list(args),
        cwd=str(cwd) if cwd is not None else None,
        input=input_bytes,
        capture_output=True,
        text=input_bytes is None,
        encoding="utf-8" if input_bytes is None else None,
        errors="replace" if input_bytes is None else None,
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
        try:
            if (candidate / ".git").exists():
                return candidate.resolve()
        except OSError:
            continue
    return None


def _git_show(root: Path, path: str) -> str:
    result = _run("git", "-C", str(root), "show", f"{REQUIRED_COMMIT}:{path}")
    if result.returncode != 0 or not isinstance(result.stdout, str):
        raise RuntimeError(f"pinned source file unavailable: {path}")
    return result.stdout


def _source_contract(root: Path | None) -> dict[str, Any]:
    if root is None:
        return {
            "available": False,
            "runtimeHead": None,
            "commitObject": False,
            "constructorSkipMemory": False,
            "forwardedSkipMemory": False,
            "mcpIncludeFilter": False,
            "sourceMode": "missing",
        }
    commit = _run("git", "-C", str(root), "cat-file", "-e", f"{REQUIRED_COMMIT}^{{commit}}")
    head = _run("git", "-C", str(root), "rev-parse", "HEAD")
    try:
        agent_init = _git_show(root, "agent/agent_init.py")
        agent_entry = _git_show(root, "run_agent.py")
        mcp_tool = _git_show(root, "tools/mcp_tool.py")
    except RuntimeError:
        agent_init = agent_entry = mcp_tool = ""
    constructor = bool(re.search(r"skip_memory\s*:\s*bool", agent_entry))
    forwarded = "skip_memory=skip_memory" in agent_entry and "skip_memory: bool" in agent_init
    include = all(
        marker in mcp_tool
        for marker in ("tools.include", "include_active = isinstance(include_raw", "if include_active:")
    )
    return {
        "available": commit.returncode == 0 and bool(agent_init) and bool(agent_entry) and bool(mcp_tool),
        "runtimeHead": head.stdout.strip() if head.returncode == 0 else None,
        "commitObject": commit.returncode == 0,
        "constructorSkipMemory": constructor,
        "forwardedSkipMemory": forwarded,
        "mcpIncludeFilter": include,
        "sourceMode": "exact-git-commit-object",
    }


def _extract_pinned_source(root: Path, destination: Path) -> None:
    """Extract only the exact pinned git tree into a disposable directory."""
    archive = subprocess.run(
        ["git", "-C", str(root), "archive", REQUIRED_COMMIT, "--", *PINNED_SOURCE_PATHS],
        capture_output=True,
        check=False,
    )
    if archive.returncode != 0 or not isinstance(archive.stdout, bytes):
        raise RuntimeError("unable to archive pinned Hermes commit")
    destination.mkdir(parents=True, exist_ok=True)
    base = destination.resolve()
    with tarfile.open(fileobj=io.BytesIO(archive.stdout), mode="r:") as bundle:
        for member in bundle.getmembers():
            target = (destination / member.name).resolve()
            if target != base and base not in target.parents:
                raise RuntimeError("pinned archive path escapes disposable import root")
        bundle.extractall(destination)


def _actual_agent_composition(scenario: str, source_root: Path) -> dict[str, Any]:
    """Register a disconnected local MCP server and initialize real AIAgent."""
    isolated = Path(tempfile.mkdtemp(prefix="real-ming-pinned-hermes-"))
    # Always use a disposable home. An interactive HERMES_HOME may contain
    # credentials, mutable configuration or ACLs that are outside this proof's
    # authority; the probe must never read or overwrite it.
    hermes_home = isolated / ".hermes"
    import_root = hermes_home / "native-knowledge-pinned-source"
    hermes_home.mkdir(parents=True, exist_ok=True)
    marker = import_root / ".real-ming-pinned-commit"
    if not import_root.is_dir() or not marker.is_file() or marker.read_text(encoding="utf-8").strip() != REQUIRED_COMMIT:
        if import_root.exists():
            shutil.rmtree(import_root, ignore_errors=True)
        temporary_source = hermes_home / "native-knowledge-pinned-source.tmp"
        if temporary_source.exists():
            shutil.rmtree(temporary_source, ignore_errors=True)
        _extract_pinned_source(source_root, temporary_source)
        marker_tmp = temporary_source / ".real-ming-pinned-commit"
        marker_tmp.write_text(REQUIRED_COMMIT + "\n", encoding="utf-8")
        temporary_source.replace(import_root)
    # Disable progressive disclosure so the AIAgent snapshot exposes the exact
    # registered callable set instead of the three search bridge tools.
    (hermes_home / "config.yaml").write_text(
        "tools:\n  tool_search:\n    enabled: off\n", encoding="utf-8"
    )
    original_cwd = Path.cwd()
    original_path = list(sys.path)
    old_home = os.environ.get("HERMES_HOME")
    os.environ["HERMES_HOME"] = str(hermes_home)
    sys.path.insert(0, str(import_root))
    # Modules outside the pinned composition slice (for example optional
    # provider adapters) are resolved from the installed checkout, while the
    # AIAgent, model-tools and MCP modules above are guaranteed to be the
    # extracted commit object at index 0.
    sys.path.insert(1, str(source_root))
    os.chdir(import_root)
    try:
        from tools import mcp_tool  # type: ignore[import-not-found]
        import run_agent  # type: ignore[import-not-found]

        mcp_tool._servers.clear()
        include: list[str] | None = list(PERMITTED_TOOLS)
        enabled_toolsets: list[str] | None = ["real-ming"]
        requested_skip_memory = True
        if scenario == "missing-skip-memory":
            requested_skip_memory = False
        elif scenario == "unsupported-include":
            include = None
        elif scenario == "extra-tool":
            include = list(PERMITTED_TOOLS) + [DENIED_TOOLS[0]]
        elif scenario == "default-toolset":
            include = None
            enabled_toolsets = None

        server = mcp_tool.MCPServerTask("real-ming")
        # A non-None session makes Hermes' own MCP availability check pass; it
        # is a plain object and has no transport or network methods.
        server.session = object()
        all_tools = PERMITTED_TOOLS + DENIED_TOOLS
        server._tools = [
            SimpleNamespace(
                name=name,
                description=f"local deterministic fixture {name}",
                inputSchema={"type": "object", "properties": {}},
            )
            for name in all_tools
        ]
        server.initialize_result = SimpleNamespace(
            capabilities=SimpleNamespace(resources=None, prompts=None)
        )
        mcp_tool._servers["real-ming"] = server
        config: dict[str, Any] = {
            "trust": "full",
            "tools": {
                "include": include,
                "resources": False,
                "prompts": False,
            },
        }
        registered = mcp_tool._register_server_tools("real-ming", server, config)
        agent = run_agent.AIAgent(
            provider="custom",
            api_mode="chat_completions",
            # A loopback discard endpoint makes provider construction explicit
            # without consulting a configured provider or making a request.
            base_url="http://127.0.0.1:9/v1",
            api_key="offline-local-deterministic-stub",
            model="offline-local",
            enabled_toolsets=enabled_toolsets,
            disabled_toolsets=["memory", "terminal", "code_execution", "browser"],
            skip_memory=requested_skip_memory,
            skip_background_review=True,
            skip_context_files=True,
            quiet_mode=True,
            platform="cron",
        )
        valid_names = sorted(getattr(agent, "valid_tool_names", set()))
        mcp_names = [name for name in valid_names if name.startswith(MCP_PREFIX)]
        effective = [name.removeprefix(MCP_PREFIX) for name in mcp_names]
        known_order = PERMITTED_TOOLS + DENIED_TOOLS
        effective.sort(key=lambda name: known_order.index(name) if name in known_order else len(known_order))
        forbidden_runtime = [
            name
            for name in valid_names
            if name in {"terminal", "process_manage", "read_file", "write_file", "patch", "search_files", "memory"}
            or "telegram" in name.lower()
        ]
        memory_disabled = (
            getattr(agent, "_memory_store", None) is None
            and getattr(agent, "_memory_manager", None) is None
            and not bool(getattr(agent, "_memory_enabled", False))
            and not bool(getattr(agent, "_user_profile_enabled", False))
        )
        return {
            "requestedSkipMemory": requested_skip_memory,
            "memoryDisabled": memory_disabled,
            "actualAIAgent": True,
            "enabledToolsets": enabled_toolsets,
            "registeredMcpTools": registered,
            "effectiveMcpTools": effective,
            "effectiveCallableNames": valid_names,
            "forbiddenRuntimeCallables": forbidden_runtime,
            "toolSearch": "off",
            "authentication": {
                "mode": "offline-local-deterministic-stub",
                "provider": "custom",
                "network": "disabled",
                "credentials": "none",
            },
        }
    finally:
        os.chdir(original_cwd)
        sys.path[:] = original_path
        if old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = old_home
        shutil.rmtree(isolated, ignore_errors=True)


def _current_user() -> str | None:
    result = _run("whoami") if os.name == "nt" else None
    user = result.stdout.strip() if result and result.returncode == 0 and isinstance(result.stdout, str) else None
    return user or None


def _set_read_only(path: Path, user: str | None) -> tuple[bool, str]:
    if os.name == "nt":
        if user is None:
            return False, "whoami-unavailable"
        result = _run("icacls", str(path), "/inheritance:r", "/grant:r", f"{user}:(OI)(CI)(RX)", "/deny", f"{user}:(OI)(CI)(W)")
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
    if os.name != "nt" and hasattr(os, "geteuid") and os.geteuid() == 0:
        return False, [], [], "root-unverifiable", "os-containment-requires-unprivileged-identity"
    base = Path(tempfile.mkdtemp(prefix="real-ming-task0-"))
    writable = [base / "staging", base / "job-session"]
    denied = [base / name for name in ("native-memory", "profile", "config", "skills", "plugins", "cron", "credentials", "unrelated")]
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


def _probe(scenario: str, source_override: str | None) -> dict[str, Any]:
    source_root = _resolve_source_root(source_override)
    source = _source_contract(source_root)
    auth_ok = (
        scenario != "missing-auth-separation"
        and os.environ.get("REAL_MING_NETWORK_DISABLED") == "1"
        and os.environ.get("REAL_MING_NO_CREDENTIALS") == "1"
        and not any(name in os.environ for name in KNOWN_CREDENTIAL_NAMES)
    )
    reasons: list[str] = []
    composition: dict[str, Any] = {
        "actualAIAgent": False,
        "requestedSkipMemory": True,
        "memoryDisabled": False,
        "enabledToolsets": ["real-ming"],
        "effectiveMcpTools": [],
        "effectiveCallableNames": [],
        "registeredMcpTools": [],
        "forbiddenRuntimeCallables": [],
        "authentication": {"mode": "unavailable"},
    }
    if not source["available"] or not source["commitObject"]:
        reasons.append("pinned-source-unavailable")
    elif source_root is not None:
        try:
            composition = _actual_agent_composition(scenario, source_root)
        except Exception as exc:  # noqa: BLE001 - report a redacted type only
            reasons.append(f"actual-aiaagent-composition-failed:{type(exc).__name__}")
    else:
        reasons.append("pinned-source-unavailable")
    if not source["constructorSkipMemory"] or not source["forwardedSkipMemory"] or not composition.get("requestedSkipMemory") or not composition.get("memoryDisabled"):
        reasons.append("skip-memory-unsupported-or-enabled")
    effective = composition.get("effectiveMcpTools", [])
    if effective != PERMITTED_TOOLS:
        reasons.append("effective-callable-set-not-exact")
    if composition.get("forbiddenRuntimeCallables"):
        reasons.append("forbidden-runtime-callable-present")
    if composition.get("enabledToolsets") != ["real-ming"]:
        reasons.append("enabled-toolsets-not-exact")
    if scenario in {"unsupported-include", "extra-tool", "default-toolset"}:
        if not effective or effective == PERMITTED_TOOLS:
            reasons.append("invalid-include-not-rejected")
    if not auth_ok:
        reasons.append("authentication-not-separated")
    os_ok, writable, denied_targets, containment_mode, os_reason = _exercise_os_containment(scenario)
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
        "skipMemory": bool(composition.get("requestedSkipMemory")),
        "memoryDisabled": bool(composition.get("memoryDisabled")),
        "actualAIAgent": bool(composition.get("actualAIAgent")),
        "enabledToolsets": composition.get("enabledToolsets"),
        "registeredMcpTools": composition.get("registeredMcpTools"),
        "effectiveMcpTools": effective,
        "effectiveCallableNames": composition.get("effectiveCallableNames"),
        "deniedMcpTools": [tool for tool in DENIED_TOOLS if tool not in effective],
        "authMode": composition.get("authentication", {}).get("mode", "unavailable") if auth_ok else "inherited-or-credentialed",
        "networkDisabled": os.environ.get("REAL_MING_NETWORK_DISABLED") == "1",
        "credentialsPresent": any(name in os.environ for name in KNOWN_CREDENTIAL_NAMES),
        "writableRoots": writable,
        "deniedTargets": denied_targets,
        "containmentMode": containment_mode,
        "fallbackDetected": effective != PERMITTED_TOOLS,
        "agentLaunch": {
            "mode": "actual-pinned-aiaagent" if composition.get("actualAIAgent") else "unavailable",
            "skipMemory": bool(composition.get("requestedSkipMemory")),
            "memoryDisabled": bool(composition.get("memoryDisabled")),
            "enabledToolsets": composition.get("enabledToolsets"),
            "network": "disabled",
            "credentials": "none" if auth_ok else "not-separated",
        },
        "eligible": not reasons,
        "reason": ";".join(reasons) if reasons else None,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", default="valid")
    parser.add_argument("--source-root")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = _probe(args.scenario, args.source_root)
    print(json.dumps(result, indent=0 if args.json else 2, sort_keys=True))
    return 0 if result["eligible"] else 78


if __name__ == "__main__":
    sys.exit(main())
