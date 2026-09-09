#!/usr/bin/env python3
"""Fail-closed launcher for the bounded native knowledge consolidation job.

The wrapper is intentionally a small process boundary. It proves the exact
pinned Hermes isolation contract first, then invokes the Hermes-driven job
entry point. It never enables recurrence, contacts a provider or inherits
interactive credentials. ``--controlled`` is an offline/local invocation
until a separately approved one-shot deployment supplies an equivalent
integration.
"""

from __future__ import annotations

import atexit
import json
import os
import shutil
import subprocess
import tempfile
import sys
from pathlib import Path

PINNED_COMMIT = "561b053f794a1781868bb032029d589c67708119"
PERMITTED = (
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
)
# This is an allowlist, not a denylist. Values are copied only when they are
# needed to locate the executable or the bounded local fixture roots. In
# particular, the parent environment is never passed wholesale to Hermes.
SAFE_ENV_NAMES = (
    "PATH",
    "PATHEXT",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LOCALAPPDATA",
    "HERMES_AGENT_SOURCE",
    "HERMES_REQUIRED_COMMIT",
    "HERMES_MCP_TOOLS",
    "HERMES_SKIP_MEMORY",
    "HERMES_KNOWLEDGE_AUTH_PROFILE",
    "REAL_MING_PYTHON",
    "REAL_MING_NETWORK_DISABLED",
    "REAL_MING_NO_CREDENTIALS",
    "REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH",
    "REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT",
    "REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT",
    "REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE",
    "REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE",
    "REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE",
    "REAL_MING_STATE_PATH",
    "REAL_MING_KNOWLEDGE_NOW",
    "REAL_MING_KNOWLEDGE_WRAPPER_TIMEOUT_SECONDS",
)


def fail(message: str, code: int = 78) -> int:
    print(json.dumps({"eligible": False, "executed": False, "activated": False, "reason": message}, sort_keys=True))
    return code


def resolve_pinned_python() -> str | None:
    """Find a Hermes-compatible interpreter without a Windows-only path."""
    override = os.environ.get("REAL_MING_PYTHON", "").strip()
    candidates: list[str] = []
    if override:
        candidates.append(override)
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        candidates.append(str(Path(local_app_data) / "hermes" / "hermes-agent" / "venv" / "Scripts" / "python.exe"))
    candidates.extend(["python3", "python"])
    for candidate in candidates:
        try:
            if ("\\" in candidate or "/" in candidate) and not Path(candidate).exists():
                continue
            check = subprocess.run(
                [candidate, "--version"],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.SubprocessError):
            continue
        if check.returncode == 0:
            return candidate
    return None


def isolated_environment() -> dict[str, str]:
    """Build the child environment from an explicit safe allowlist."""
    child: dict[str, str] = {}
    for name in SAFE_ENV_NAMES:
        value = os.environ.get(name)
        if value is not None and value != "":
            child[name] = value
    # The job receives a disposable Hermes home, never the interactive home.
    hermes_home = Path(tempfile.mkdtemp(prefix="real-ming-native-hermes-home-"))
    atexit.register(shutil.rmtree, hermes_home, True)
    child["HERMES_HOME"] = str(hermes_home)
    child["HERMES_REQUIRED_COMMIT"] = PINNED_COMMIT
    child["REAL_MING_NETWORK_DISABLED"] = "1"
    child["REAL_MING_NO_CREDENTIALS"] = "1"
    child["REAL_MING_KNOWLEDGE_JOB"] = "1"
    return child


def main() -> int:
    if "--controlled" not in sys.argv:
        return fail("live launch is not enabled by this wrapper; use an approved one-shot integration", 78)
    if os.environ.get("HERMES_SKIP_MEMORY") != "1":
        return fail("HERMES_SKIP_MEMORY must be 1")
    requested = tuple(filter(None, os.environ.get("HERMES_MCP_TOOLS", "").split(",")))
    if requested != PERMITTED:
        return fail("effective MCP callable set is not exactly the four permitted operations")
    if not os.environ.get("HERMES_KNOWLEDGE_AUTH_PROFILE"):
        return fail("named knowledge auth profile is required; interactive credentials are not inherited")
    required_paths = (
        "REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH",
        "REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT",
        "REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT",
        "REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE",
        "REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE",
    )
    missing_paths = [name for name in required_paths if not os.environ.get(name, "").strip()]
    if missing_paths:
        return fail(f"required native knowledge route is missing: {missing_paths[0]}")
    interpreter = resolve_pinned_python()
    if interpreter is None:
        return fail("portable pinned-Hermes interpreter is unavailable")
    probe = Path(__file__).with_name("verify-native-knowledge-isolation.py")
    env = isolated_environment()
    completed = subprocess.run(
        [interpreter, str(probe), "--json"],
        check=False,
        capture_output=True,
        text=True,
        env=env,
    )
    if completed.returncode != 0:
        # Preserve only the structured eligibility result, never probe logs or
        # environment values that could contain credentials.
        try:
            payload = json.loads(completed.stdout)
            return fail(payload.get("reason", "pinned isolation preflight failed"), 78)
        except json.JSONDecodeError:
            return fail("pinned isolation preflight failed", 78)
    try:
        payload = json.loads(completed.stdout)
    except json.JSONDecodeError:
        return fail("pinned isolation preflight did not return JSON", 78)
    if (
        payload.get("effectiveMcpTools") != list(PERMITTED)
        or not payload.get("eligible")
        or payload.get("runtimeHeadMatchesPinned") is not True
        or payload.get("actualAIAgent") is not True
        or payload.get("containmentProof") is not True
    ):
        return fail("preflight did not prove the exact callable set", 78)
    # Carry only the verified boolean into the child. The Node composition
    # never treats a caller-provided self-attestation as sufficient on its own.
    env["REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE"] = "true"
    entrypoint = Path(__file__).with_name("run-native-knowledge-hermes-job.py")
    if not entrypoint.is_file():
        return fail("Hermes-driven consolidation entry point is unavailable")
    try:
        job = subprocess.run(
            [interpreter, str(entrypoint), "--controlled"],
            check=False,
            capture_output=True,
            text=True,
            timeout=env_timeout_seconds(),
            env=env,
        )
    except subprocess.TimeoutExpired:
        return fail("native knowledge consolidation timed out", 1)
    try:
        job_payload = json.loads(job.stdout)
    except json.JSONDecodeError:
        return fail("native knowledge consolidation did not return JSON", 1)
    if (
        job.returncode != 0
        or not job_payload.get("executed")
        or job_payload.get("runtime") != "native-hermes"
        or job_payload.get("hermesExecuted") is not True
    ):
        reason = job_payload.get("reason", "native knowledge consolidation failed")
        return fail(str(reason), job.returncode if job.returncode != 0 else 1)
    print(json.dumps({
        "eligible": True,
        "mode": "controlled-native-hermes",
        "commit": PINNED_COMMIT,
        **job_payload,
    }, sort_keys=True))
    return 0


def env_timeout_seconds() -> float:
    raw = os.environ.get("REAL_MING_KNOWLEDGE_WRAPPER_TIMEOUT_SECONDS", "600").strip()
    try:
        value = float(raw)
    except ValueError:
        return 600.0
    return value if value > 0 else 600.0


if __name__ == "__main__":
    sys.exit(main())
