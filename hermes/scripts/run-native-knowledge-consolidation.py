#!/usr/bin/env python3
"""Fail-closed wrapper for the inactive native knowledge cron proposal.

The controlled form only proves the exact pinned invocation boundary. It does
not activate cron, contact a provider, or inherit the interactive Hermes
environment. A separately approved live one-shot must supply the same values
and an explicit launch integration.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

PINNED_COMMIT = "561b053f794a1781868bb032029d589c67708119"
PERMITTED = (
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
)


def fail(message: str, code: int = 78) -> int:
    print(json.dumps({"eligible": False, "reason": message}, sort_keys=True))
    return code


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
    probe = Path(__file__).with_name("verify-native-knowledge-isolation.py")
    env = os.environ.copy()
    env["HERMES_REQUIRED_COMMIT"] = PINNED_COMMIT
    completed = subprocess.run(
        [sys.executable, str(probe)],
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
    if payload.get("effectiveMcpTools") != list(PERMITTED) or not payload.get("eligible"):
        return fail("preflight did not prove the exact callable set", 78)
    print(json.dumps({"eligible": True, "mode": "controlled", "commit": PINNED_COMMIT}, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
