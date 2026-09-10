#!/usr/bin/env python3
"""Run one bounded native-knowledge consolidation through pinned Hermes.

This executable is deliberately separate from the offline fixture.  It starts
the repository's real MCP composition over a local pipe, registers that server
through the pinned Hermes ``AIAgent`` path, and uses a deterministic model
adapter only for offline controlled runs.  The adapter still receives the
real tool schemas/results and produces pages from the admitted candidate and
source; it never calls a provider or the network.

The wrapper that invokes this module supplies an explicit environment and
performs the stronger isolation preflight.  A missing/mismatched pinned
checkout, route, tool surface, or synthesis result fails closed.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Any


PINNED_COMMIT = "561b053f794a1781868bb032029d589c67708119"
PERMITTED_TOOLS = [
    "real_ming_knowledge_list_candidates",
    "real_ming_read_knowledge_source",
    "real_ming_stage_knowledge_generation",
    "real_ming_wiki_retrieve",
]

# The launcher and this job both construct child environments from an
# allowlist. Keeping the second boundary here prevents a future caller from
# accidentally reintroducing a broad ``REAL_MING_*``/``HERMES_*`` inheritance
# rule between the Hermes process and the MCP composition.
CHILD_ENV_NAMES = {
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
    "REAL_MING_NETWORK_DISABLED",
    "REAL_MING_NO_CREDENTIALS",
    "REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH",
    "REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT",
    "REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT",
    "REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE",
    "REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE",
    "REAL_MING_STATE_PATH",
    "REAL_MING_KNOWLEDGE_NOW",
    "REAL_MING_NATIVE_KNOWLEDGE_ISOLATION_ELIGIBLE",
}

NETWORK_DENY_PRELOAD = """
const denied = () => { throw new Error('network disabled for controlled native knowledge job'); };
const net = require('node:net');
net.connect = denied;
net.createConnection = denied;
const http = require('node:http');
http.request = denied;
http.get = denied;
const https = require('node:https');
https.request = denied;
https.get = denied;
const tls = require('node:tls');
tls.connect = denied;
const dgram = require('node:dgram');
dgram.createSocket = denied;
const dns = require('node:dns');
dns.lookup = denied;
dns.resolve = denied;
const http2 = require('node:http2');
http2.connect = denied;
globalThis.fetch = denied;
""".strip() + "\n"


def fail(message: str, code: int = 78) -> int:
    print(json.dumps({"eligible": False, "executed": False, "activated": False, "reason": message}, sort_keys=True))
    return code


def enforce_python_network_boundary() -> None:
    """Deny socket creation in the actual AIAgent process for this probe."""
    def denied(*_args: Any, **_kwargs: Any) -> Any:
        raise OSError("network disabled for controlled native knowledge job")

    socket.socket.connect = denied  # type: ignore[method-assign]
    socket.socket.connect_ex = denied  # type: ignore[method-assign]
    socket.create_connection = denied  # type: ignore[assignment]
    socket.getaddrinfo = denied  # type: ignore[assignment]


def write_network_preload(directory: Path | None = None) -> Path:
    descriptor, raw_path = tempfile.mkstemp(
        prefix="network-deny-",
        suffix=".cjs",
        dir=None if directory is None else str(directory),
    )
    os.close(descriptor)
    path = Path(raw_path)
    path.write_text(NETWORK_DENY_PRELOAD, encoding="utf-8")
    return path


def required_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def resolve_source_root() -> Path:
    candidates = []
    explicit = os.environ.get("HERMES_AGENT_SOURCE", "").strip()
    if explicit:
        candidates.append(Path(explicit))
    local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
    if local_app_data:
        candidates.append(Path(local_app_data) / "hermes" / "hermes-agent")
    candidates.extend([Path("/opt/hermes-agent-561b053f"), Path("/var/lib/hermes-real-ming/hermes-agent")])
    for root in candidates:
        try:
            if not (root / ".git").exists():
                continue
            head = subprocess.run(
                ["git", "-C", str(root), "rev-parse", "HEAD"],
                capture_output=True,
                text=True,
                check=False,
            )
            obj = subprocess.run(
                ["git", "-C", str(root), "cat-file", "-e", f"{PINNED_COMMIT}^{{commit}}"],
                capture_output=True,
                text=True,
                check=False,
            )
            clean = subprocess.run(
                ["git", "-C", str(root), "status", "--porcelain", "--untracked-files=no"],
                capture_output=True,
                text=True,
                check=False,
            )
            if (
                head.returncode == 0
                and head.stdout.strip() == PINNED_COMMIT
                and obj.returncode == 0
                and clean.returncode == 0
                and clean.stdout.strip() == ""
            ):
                return root.resolve()
        except OSError:
            continue
    raise RuntimeError("pinned Hermes source checkout is unavailable or HEAD does not match the approved commit")


class JsonRpcClient:
    """Small synchronous client for the repository's newline JSON-RPC MCP."""

    def __init__(self, process: subprocess.Popen[str], timeout: float = 30.0) -> None:
        self.process = process
        self.timeout = timeout
        self.next_id = 1

    def call(self, method: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if self.process.stdin is None or self.process.stdout is None:
            raise RuntimeError("MCP process pipes are unavailable")
        request_id = self.next_id
        self.next_id += 1
        self.process.stdin.write(json.dumps({"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}) + "\n")
        self.process.stdin.flush()
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            line = self.process.stdout.readline()
            if line == "":
                raise RuntimeError("MCP composition closed before returning a result")
            try:
                response = json.loads(line)
            except json.JSONDecodeError:
                continue
            if response.get("id") != request_id:
                continue
            if "error" in response:
                raise RuntimeError("MCP protocol request failed")
            result = response.get("result")
            return result if isinstance(result, dict) else {}
        raise RuntimeError("MCP composition request timed out")

    def close(self) -> None:
        if self.process.stdin is not None:
            try:
                self.process.stdin.close()
            except OSError:
                pass
        try:
            self.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.process.kill()
            self.process.wait(timeout=5)


class LocalMcpSession:
    """The exact async method the pinned MCP handler invokes."""

    def __init__(self, client: JsonRpcClient) -> None:
        self.client = client

    async def call_tool(self, name: str, arguments: dict[str, Any]) -> Any:
        result = await asyncio.to_thread(self.client.call, "tools/call", {"name": name, "arguments": arguments})
        content = result.get("content") if isinstance(result, dict) else None
        text = ""
        if isinstance(content, list) and content and isinstance(content[0], dict):
            text = str(content[0].get("text", ""))
        return SimpleNamespace(
            content=[SimpleNamespace(type="text", text=text)],
            isError=bool(result.get("isError")) if isinstance(result, dict) else True,
        )


def parse_tool_text(result: Any) -> Any:
    content = result.get("content") if isinstance(result, dict) else None
    if not isinstance(content, list) or not content or not isinstance(content[0], dict):
        raise RuntimeError("Hermes MCP result had no text content")
    text = content[0].get("text")
    if not isinstance(text, str):
        raise RuntimeError("Hermes MCP result text is invalid")
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("Hermes MCP result was not JSON") from exc


def _tool_call(name: str, arguments: dict[str, Any], call_id: str) -> Any:
    return SimpleNamespace(
        id=call_id,
        type="function",
        function=SimpleNamespace(name=name, arguments=json.dumps(arguments, separators=(",", ":"))),
    )


def _decode_model_tool_payload(content: Any) -> Any:
    """Decode the pinned Hermes tool-result envelope used by MCP calls.

    Hermes deliberately frames MCP output as untrusted data before returning
    it to the model.  The deterministic offline adapter must consume the
    same framed value; it must not bypass the production handler or assume
    that raw JSON is delivered directly.
    """
    if not isinstance(content, str):
        return content
    try:
        envelope: Any = json.loads(content)
    except json.JSONDecodeError:
        envelope = content
    framed = re.search(
        r"<untrusted_tool_result[^>]*>\s*.*?\n\n(.*?)\n</untrusted_tool_result>",
        envelope,
        flags=re.DOTALL,
    )
    if framed:
        envelope = framed.group(1)
    # The production MCP handler adds a JSON ``result`` envelope around the
    # server's JSON text, and the surrounding Hermes message then frames that
    # envelope as untrusted data.  Unwrap/parse those bounded layers without
    # assuming anything about the candidate or source payload itself.
    for _ in range(3):
        if isinstance(envelope, dict) and "result" in envelope:
            envelope = envelope["result"]
            continue
        if isinstance(envelope, str):
            try:
                envelope = json.loads(envelope)
            except json.JSONDecodeError as exc:
                raise RuntimeError("Hermes returned an invalid MCP tool result") from exc
            continue
        break
    return envelope


def model_response(messages: list[dict[str, Any]], state: dict[str, Any]) -> Any:
    """Deterministic offline model that uses actual MCP results as inputs."""
    tool_messages = [message for message in messages if message.get("role") == "tool"]
    if not tool_messages:
        state["step"] = 1
        return SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    tool_calls=[_tool_call("mcp__real_ming__real_ming_knowledge_list_candidates", {"status": "staged"}, "list-1")],
                ),
                finish_reason="tool_calls",
            )],
        )
    last = tool_messages[-1]
    content = last.get("content")
    value = _decode_model_tool_payload(content)
    previous_tool = state.get("last_tool")
    if previous_tool is None:
        # The first result is the candidate metadata list.  The model chooses
        # only an admitted candidate returned by the production operation.
        candidates = value.get("candidates") if isinstance(value, dict) else None
        if not isinstance(candidates, list) or not candidates:
            # An empty admitted queue is a successful bounded no-op.  A
            # malformed MCP payload, however, was already rejected by the
            # decoder above; do not invent a page or claim activation.
            state["pages"] = []
            state["last_tool"] = "list"
            return SimpleNamespace(
                choices=[SimpleNamespace(
                    message=SimpleNamespace(content=json.dumps({"pages": []}), tool_calls=[]),
                    finish_reason="stop",
                )]
            )
        first = candidates[0]
        if not isinstance(first, dict) or not isinstance(first.get("candidateId"), str):
            raise RuntimeError("candidate metadata was invalid")
        state["candidate"] = first
        state["last_tool"] = "list"
        return SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(
                    content=None,
                    tool_calls=[_tool_call(
                        "mcp__real_ming__real_ming_read_knowledge_source",
                        {
                            "sourceIdentity": first.get("sourceIdentity"),
                            "sourceReference": first.get("sourceReference"),
                            "sourceVersion": first.get("sourceVersion"),
                        },
                        "read-1",
                    )],
                ),
                finish_reason="tool_calls",
            )],
        )
    if previous_tool == "list":
        source = value
        candidate = state.get("candidate")
        if not isinstance(candidate, dict) or not isinstance(source, dict):
            raise RuntimeError("source or candidate result was invalid")
        claim = candidate.get("claim")
        if not isinstance(claim, str):
            # Registry metadata intentionally omits prose. The synthesis
            # receives source-backed text, not a fixed claim.
            claim = source.get("content")
        if not isinstance(claim, str):
            raise RuntimeError("source content was unavailable for synthesis")
        page_id = candidate.get("candidateId")
        source_reference = candidate.get("sourceReference")
        source_candidate_id = candidate.get("candidateId")
        page = {
            "pageId": page_id,
            "path": f"pages/{page_id}.md",
            "content": f"# Source-backed knowledge\n\n{claim}\n",
            "sourceCandidateIds": [source_candidate_id],
            "dependencies": list(candidate.get("dependencies") or []),
            "claimClass": candidate.get("claimClass"),
            "sourceReference": source_reference,
            "capturedAt": candidate.get("capturedAt"),
            "asOf": candidate.get("asOf"),
            "disposition": "supported",
            "uncertainty": "none",
        }
        state["pages"] = [page]
        state["last_tool"] = "read"
        return SimpleNamespace(
            choices=[SimpleNamespace(
                message=SimpleNamespace(content=json.dumps({"pages": [page]}, separators=(",", ":")), tool_calls=[]),
                finish_reason="stop",
            )],
        )
    raise RuntimeError("unexpected Hermes tool-call sequence")


def run_hermes_job() -> dict[str, Any]:
    enforce_python_network_boundary()
    source_root = resolve_source_root()
    required_env("REAL_MING_NATIVE_KNOWLEDGE_STATE_PATH")
    required_env("REAL_MING_NATIVE_KNOWLEDGE_GENERATED_ROOT")
    required_env("REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT")
    required_env("REAL_MING_NATIVE_KNOWLEDGE_SOURCE_ROUTE")
    required_env("REAL_MING_NATIVE_KNOWLEDGE_CANDIDATES_ROUTE")
    if os.environ.get("REAL_MING_NETWORK_DISABLED") != "1" or os.environ.get("REAL_MING_NO_CREDENTIALS") != "1":
        raise RuntimeError("offline no-credentials boundary is required")
    if os.environ.get("HERMES_SKIP_MEMORY") != "1":
        raise RuntimeError("HERMES_SKIP_MEMORY must be 1")
    configured_tools = [item.strip() for item in required_env("HERMES_MCP_TOOLS").split(",") if item.strip()]
    if configured_tools != PERMITTED_TOOLS:
        raise RuntimeError("native job MCP allowlist is not exact")

    repository_root = Path(__file__).parents[2]
    entrypoint = repository_root / "dist" / "config" / "real-ming-mcp-cli.js"
    if not entrypoint.is_file():
        raise RuntimeError("compiled Real-Ming MCP composition is unavailable")
    child_env = {key: value for key, value in os.environ.items() if key in CHILD_ENV_NAMES}
    child_env["REAL_MING_KNOWLEDGE_JOB"] = "1"
    staging_root = Path(required_env("REAL_MING_NATIVE_KNOWLEDGE_STAGING_ROOT")).resolve()
    if staging_root.is_symlink() or not staging_root.is_dir():
        raise RuntimeError("configured staging root is not a regular directory")
    # Every mutable process artifact (Hermes home, operations state, MCP
    # execution links and the ephemeral synthesis hand-off) stays below the
    # approved staging root. Never fall back to the repository or the global
    # temp directory for a missing operations state path.
    job_session_root = Path(tempfile.mkdtemp(prefix=".real-ming-job-session-", dir=str(staging_root)))
    child_env["HERMES_HOME"] = str(job_session_root / "hermes-home")
    child_env["REAL_MING_STATE_PATH"] = str(job_session_root / "operations.sqlite")
    network_preload = write_network_preload(job_session_root)
    child_env["NODE_OPTIONS"] = f"--require={network_preload}"
    mcp_process: subprocess.Popen[str] | None = None
    client: JsonRpcClient | None = None
    old_path = list(sys.path)
    old_home = os.environ.get("HERMES_HOME")
    synthesis_dir: Path | None = None
    try:
        # Start the composition inside the protected try/finally boundary so
        # a launch failure cannot strand a job-session directory or preload.
        mcp_process = subprocess.Popen(
            ["node", str(entrypoint)],
            cwd=str(repository_root),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            env=child_env,
        )
        client = JsonRpcClient(mcp_process)
        initialized = client.call("initialize", {"protocolVersion": "2024-11-05"})
        if not isinstance(initialized.get("capabilities"), dict):
            raise RuntimeError("MCP initialize did not advertise capabilities")
        listed = client.call("tools/list")
        raw_tools = listed.get("tools")
        if not isinstance(raw_tools, list):
            raise RuntimeError("MCP tools/list returned no tools")
        names = [item.get("name") for item in raw_tools if isinstance(item, dict) and isinstance(item.get("name"), str)]
        if names != PERMITTED_TOOLS:
            raise RuntimeError("production MCP callable set is not exact")

        sys.path.insert(0, str(source_root))
        agent_home = job_session_root / "agent-home"
        agent_home.mkdir(parents=True, exist_ok=True)
        # The pinned runtime's progressive tool disclosure is a separate
        # model-facing bridge.  This job must measure and call the exact
        # reviewed MCP set directly, so the disposable profile explicitly
        # disables that optional bridge without touching Ming's profile.
        (agent_home / "config.yaml").write_text(
            "tools:\n  tool_search:\n    enabled: off\n",
            encoding="utf-8",
        )
        os.environ["HERMES_HOME"] = str(agent_home)
        from tools import mcp_tool  # type: ignore[import-not-found]
        import run_agent  # type: ignore[import-not-found]

        mcp_tool._servers.clear()
        server = mcp_tool.MCPServerTask("real-ming")
        if client is None:
            raise RuntimeError("MCP client was not initialized")
        server.session = LocalMcpSession(client)
        server._tools = [
            SimpleNamespace(
                name=item["name"],
                description=item.get("description", ""),
                inputSchema=item.get("inputSchema", {}),
            )
            for item in raw_tools
            if isinstance(item, dict) and isinstance(item.get("name"), str)
        ]
        server.initialize_result = SimpleNamespace(capabilities=SimpleNamespace(resources=None, prompts=None))
        mcp_tool._servers["real-ming"] = server
        registered = mcp_tool._register_server_tools(
            "real-ming",
            server,
            {"trust": "full", "tools": {"include": PERMITTED_TOOLS, "resources": False, "prompts": False}},
        )
        # Hermes' MCP handlers dispatch through its shared background event
        # loop.  The server transport itself is the local JSON-RPC pipe, but
        # the real pinned handler still needs that loop running; otherwise a
        # tool call fails closed before reaching the composition.
        mcp_tool._ensure_mcp_loop()
        expected_registered = [f"mcp__real_ming__{name}" for name in PERMITTED_TOOLS]
        if registered != expected_registered:
            raise RuntimeError(f"pinned Hermes MCP registration did not preserve exact allowlist ({registered})")
        agent = run_agent.AIAgent(
            provider="custom",
            api_mode="chat_completions",
            base_url="http://127.0.0.1:9/v1",
            api_key="offline-local-deterministic-stub",
            model="offline-local",
            enabled_toolsets=["real-ming"],
            disabled_toolsets=["memory", "terminal", "code_execution", "browser"],
            skip_memory=True,
            skip_background_review=True,
            skip_context_files=True,
            quiet_mode=True,
            platform="cron",
            max_iterations=4,
        )
        agent._disable_streaming = True
        effective = sorted(name for name in getattr(agent, "valid_tool_names", set()) if name.startswith("mcp__real_ming__"))
        if effective != sorted(expected_registered):
            # Keep the diagnostic bounded and name-only so a failed local
            # probe cannot expose prompts, credentials, or tool arguments.
            all_valid = sorted(str(name) for name in getattr(agent, "valid_tool_names", set()))
            extra = sorted(set(effective) - set(expected_registered))
            missing = sorted(set(expected_registered) - set(effective))
            raise RuntimeError(
                "pinned Hermes effective callable set is not exact "
                f"(registered_count={len(registered)}; effective_count={len(effective)}; "
                f"valid={all_valid[:6]!r}; extra={extra!r}; missing={missing[:2]!r})"
            )
        state: dict[str, Any] = {}
        agent._interruptible_api_call = lambda kwargs: model_response(kwargs.get("messages", []), state)  # type: ignore[method-assign]
        conversation = agent.run_conversation(
            "Consolidate the admitted source-backed candidates. Use only the listed Real-Ming tools and return JSON with a pages array.",
        )
        final_text = conversation.get("final_response") if isinstance(conversation, dict) else None
        if not isinstance(final_text, str) or not final_text.strip():
            # Pinned Hermes can return the final assistant content separately
            # in messages when quiet mode suppresses console output.
            messages = conversation.get("messages") if isinstance(conversation, dict) else None
            if isinstance(messages, list):
                assistant = [message for message in messages if isinstance(message, dict) and message.get("role") == "assistant" and isinstance(message.get("content"), str)]
                final_text = assistant[-1].get("content") if assistant else None
        if not isinstance(final_text, str):
            raise RuntimeError("Hermes synthesis returned no final JSON")
        synthesis = json.loads(final_text)
        if not isinstance(synthesis, dict) or not isinstance(synthesis.get("pages"), list):
            raise RuntimeError("Hermes synthesis JSON is invalid")
        # Synthesis is an ephemeral hand-off between the pinned Hermes process
        # and the production Node composition.  The wrapper must not require a
        # caller-supplied path (which could point outside the job boundary).
        synthesis_dir = Path(tempfile.mkdtemp(prefix="synthesis-", dir=str(job_session_root)))
        synthesis_path = synthesis_dir / "synthesis.json"
        synthesis_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = synthesis_path.with_suffix(synthesis_path.suffix + ".tmp")
        temporary.write_text(json.dumps(synthesis, separators=(",", ":")) + "\n", encoding="utf-8")
        temporary.replace(synthesis_path)
        # The deterministic Hermes model has now produced the only variable
        # artifact. The repository's production Node composition performs the
        # evidence check, staging, filesystem installation and activation.
        child_env["REAL_MING_HERMES_EXECUTED"] = "1"
        child_env["REAL_MING_HERMES_SYNTHESIS_PATH"] = str(synthesis_path)
        publication = subprocess.run(
            ["node", str(repository_root / "dist" / "config" / "native-knowledge-consolidation-cli.js"), "--controlled"],
            cwd=str(repository_root),
            capture_output=True,
            text=True,
            timeout=60,
            env=child_env,
            check=False,
        )
        try:
            publication_payload = json.loads(publication.stdout)
        except json.JSONDecodeError as exc:
            raise RuntimeError("production consolidation entry point did not return JSON") from exc
        if publication.returncode != 0:
            reason = publication_payload.get("reason", "production publication failed") if isinstance(publication_payload, dict) else "production publication failed"
            raise RuntimeError(str(reason)[:200])
        return {
            "eligible": True,
            "executed": True,
            "hermesExecuted": True,
            "runtime": "native-hermes",
            "pinnedCommit": PINNED_COMMIT,
            "effectiveMcpTools": PERMITTED_TOOLS,
            "synthesisPath": str(synthesis_path),
            **(publication_payload if isinstance(publication_payload, dict) else {}),
        }
    finally:
        sys.path[:] = old_path
        if old_home is None:
            os.environ.pop("HERMES_HOME", None)
        else:
            os.environ["HERMES_HOME"] = old_home
        if client is not None:
            client.close()
        elif mcp_process is not None:
            try:
                mcp_process.kill()
                mcp_process.wait(timeout=5)
            except (OSError, subprocess.TimeoutExpired):
                pass
        try:
            if mcp_process is not None and mcp_process.stderr is not None:
                mcp_process.stderr.read(4096)
        except OSError:
            pass
        try:
            network_preload.unlink(missing_ok=True)
        except OSError:
            pass
        if synthesis_dir is not None:
            try:
                shutil.rmtree(synthesis_dir, ignore_errors=True)
            except OSError:
                pass
        try:
            shutil.rmtree(job_session_root, ignore_errors=True)
        except OSError:
            pass


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--controlled", action="store_true")
    args = parser.parse_args()
    if not args.controlled:
        return fail("live native knowledge execution requires a separately approved one-shot integration")
    try:
        payload = run_hermes_job()
    except Exception as error:  # noqa: BLE001 - redact details at the boundary
        return fail(str(error)[:240], 1)
    print(json.dumps(payload, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
