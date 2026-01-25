i need to build a library that is a universal api to work with agents

## glossary

- agent = claude code, codex, and opencode -> the acutal binary/sdk that runs the coding agent
- agent mode = what the agent does, for example build/plan agent mode
- agent (id) vs agent mode: `agent` selects the implementation (claude/codex/opencode/amp), `agentMode` selects behavior (build/plan/custom). These are different from `permissionMode` (capability restrictions).
- session id vs agent session id: session id is the primary id provided by the client; agent session id is the underlying id from the agent and must be exposed but is not the primary id.
- model = claude, codex, gemni, etc -> the model that's use din the agent
- variant = variant on the model if exists, eg low, mid, high, xhigh for codex

## concepts

### architecture

this is intended to build 2 components:

- daemon that runs inside a sandbox that can run agents inside the sandbox
- sdk that talks the http api to the daemon to communicate with it

### universal api types

we need to define a universal base type for input & output from agents that is a common denominator for all agent schemas

this also needs to support quesitons (ie human in the loop)

### working with the agents

these agents all have differnet ways of working with them.

- claude code uses headless mode
- opencode uses a server

## component: daemon

this is what runs inside the sandbox to manage everything

this is a rust component that exposes an http server

**router**

use axum for routing and utoipa for the json schema and schemars for generating json schemas. see how this is done in:
- ~/rivet
	- engine/packages/config-schema-gen/build.rs
	- ~/rivet/engine/packages/api-public/src/router.rs (but use thiserror instead of anyhow)

we need a standard thiserror for error responses. return errors as RFC 7807 Problem Details

### cli

it's ran with a token like this using clap:

sandbox-agent --token <token> --host xxxx --port xxxx

(you can specify --no-token too)
(also add cors flags to the cli to configure cors, default to no cors)

also expose a CLI endpoint for every http endpoint we have (specify this in claude.md to keep this to date) so we can do:

sandbox-agent sessions get-messages --endpoint xxxx --token xxxx

### http api

POST /v1/agents/{}/install (this will install the agent)
{ reinstall?: boolean }
- `reinstall: true` forces download even if installed version matches latest.

GET /v1/agents/{}/modes
< { modes: [{ id: "build", name: "Build", description: "..." }, ...] }

GET /v1/agents
< { agents: [{ id: "claude" | "codex" | "opencode" | "amp", installed: boolean, version?: string, path?: string }] }
- Version should be checked at request time. `path` reflects the configured install location.

POST /v1/sessions/{} (will install agent if not already installed)
>
{
    agent: "claude" | "codex" | "opencode",
    agentMode?: string,        // Which agent/behavior: "build", "plan", or custom
    permissionMode?: "default" | "plan" | "bypass",  // Permission restrictions
    model?: string,
    variant?: string,
    agentVersion?: string
}
<
{
    healthy: boolean,
    error?: AgentError,
    agentSessionId?: string
}
- The client-provided session id is primary; `agentSessionId` is the underlying agent id (may be unknown until first prompt).
- Auth uses the daemon-level token (`Authorization`); per-session tokens are not supported.

// agentMode vs permissionMode:
// - agentMode = what the agent DOES (behavior, system prompt)
// - permissionMode = what the agent CAN DO (capability restrictions)
// These are separate concepts. OpenCode has custom agents. Claude has subagent types.
//
// Assertions:
// - agentMode defaults to "build" if not specified
// - permissionMode defaults to "default" if not specified
// - permissionMode "plan" = read-only (no writes), agent must use ExitPlanMode to execute
// - permissionMode "bypass" = skip all permission checks (dangerous)
// - agentMode "plan" != permissionMode "plan" (one is behavior, one is restriction)

POST /v1/sessions/{}/messages
{
    message: string
}

GET /v1/sessions/{}/events?offset=x&limit=x
<
{
	events: UniversalEvent[],
	hasMore: bool
}

GET /v1/sessions/{}/events/sse?offset=x
- same as above but using sse

POST /v1/sessions/{}/questions/{questionId}/reply
{ answers: string[][] }  // Array per question of selected option labels (multi-select supported)

POST /v1/sessions/{}/questions/{questionId}/reject
{}

POST /v1/sessions/{}/permissions/{permissionId}/reply
{ reply: "once" | "always" | "reject" }

note: Claude's plan approval (ExitPlanMode) is converted to a question event with approve/reject options. No separate endpoint needed.

types:

type UniversalEvent =
    {
        id: number,               // Monotonic per-session id (used for offset)
        timestamp: string,        // RFC3339
        sessionId: string,        // Primary id provided by client
        agent: string,            // Agent id (claude/codex/opencode/amp)
        agentSessionId?: string,  // Underlying agent session/thread id (not primary)
        data: UniversalEventData
    }

type UniversalEventData =
    | { message: UniversalMessage }
    | { started: Started }
    | { error: CrashInfo }
    | { questionAsked: QuestionRequest }
    | { permissionAsked: PermissionRequest };

// See research/human-in-the-loop.md for QuestionRequest/PermissionRequest details

type AgentError = { tokenError: ... } | { processExisted: ... } | { installFailed: ... } | etc

### error taxonomy

All error responses use RFC 7807 Problem Details and map to a Rust `thiserror` enum. Canonical `type` values should be stable strings (e.g. `urn:sandbox-agent:error:agent_not_installed`).

Required error types:

- `invalid_request` (400): malformed JSON, missing fields, invalid enum values
- `unsupported_agent` (400): unknown agent id
- `agent_not_installed` (404): agent binary missing
- `install_failed` (500): install attempted and failed
- `agent_process_exited` (500): agent subprocess exited unexpectedly
- `token_invalid` (401): token missing/invalid when required
- `permission_denied` (403): operation not allowed by permissionMode or config
- `session_not_found` (404): unknown session id
- `session_already_exists` (409): attempting to create session with existing id
- `mode_not_supported` (400): agentMode not available for agent
- `stream_error` (502): streaming/I/O failure
- `timeout` (504): agent or request timed out

The Rust error enum should capture context (agent id, session id, exit code, stderr, etc.) and translate to Problem Details in the HTTP layer and CLI. The `AgentError` payloads used in JSON responses should be derived from the same enum so HTTP and CLI stay consistent.

### offset semantics

- `offset` is the last-seen `UniversalEvent.id` (exclusive).
- `GET /v1/sessions/{id}/events` returns events with `id > offset`, ordered ascending.
- `offset` defaults to `0` (or the earliest id) if not provided.
- SSE endpoint uses the same semantics and continues streaming events after the initial batch.

### schema converters

we need to have a 2 way conversion for both:

- universal agent input message <-> agent input message
- universal agent event <-> agent event

for messages, we need to have a sepcial universal message type for failed to parse with the raw json that we attempted to parse

### managing agents

> **Note:** We do NOT use JS SDKs for agent communication. All agents are spawned as subprocesses or accessed via a shared server. This keeps the daemon language-agnostic (Rust) and avoids Node.js dependencies.

#### agent comparison

| Agent | Provider | Binary | Install Method | Session ID | Streaming Format |
|-------|----------|--------|----------------|------------|------------------|
| Claude Code | Anthropic | `claude` | curl raw binary from GCS | `session_id` (string) | JSONL via stdout |
| Codex | OpenAI | `codex` | curl tarball from GitHub releases | `thread_id` (string) | JSONL via stdout |
| OpenCode | Multi-provider | `opencode` | curl tarball from GitHub releases | `session_id` (string) | SSE or JSONL |
| Amp | Sourcegraph | `amp` | curl raw binary from GCS | `session_id` (string) | JSONL via stdout |

#### spawning approaches

There are two ways to spawn agents:

##### 1. subprocess per session

Each session spawns a dedicated agent subprocess that lives for the duration of the session.

**How it works:**
- On session create, spawn the agent binary with appropriate flags
- Communicate via stdin/stdout using JSONL
- Process terminates when session ends or times out

**Agents that support this:**
- **Claude Code**: `claude --print --output-format stream-json --verbose --dangerously-skip-permissions [--resume SESSION_ID] "PROMPT"`
- **Codex**: `codex exec --json --dangerously-bypass-approvals-and-sandbox "PROMPT"` or `codex exec resume --last`
- **Amp**: `amp --print --output-format stream-json --dangerously-skip-permissions "PROMPT"`

**Pros:**
- Simple implementation
- Process isolation per session
- No shared state to manage

**Cons:**
- Higher latency (process startup per message)
- More resource usage (one process per active session)
- No connection reuse

##### 2. shared server (preferred for OpenCode)

A single long-running server handles multiple sessions. The daemon connects to this server via HTTP/SSE.

**How it works:**
- On daemon startup (or first session for an agent), start the server if not running
- Server listens on a port (e.g., 4200-4300 range for OpenCode)
- Sessions are created/managed via HTTP API
- Events streamed via SSE

**Agents that support this:**
- **OpenCode**: `opencode serve --port PORT` starts the server, then use HTTP API:
  - `POST /session` - create session
  - `POST /session/{id}/prompt` - send message
  - `GET /event/subscribe` - SSE event stream
  - Supports questions/permissions via `/question/reply`, `/permission/reply`

**Pros:**
- Lower latency (no process startup per message)
- Shared resources across sessions
- Better for high-throughput scenarios
- Native support for SSE streaming

**Cons:**
- More complex lifecycle management
- Need to handle server crashes/restarts
- Shared state between sessions

#### which approach to use

| Agent | Recommended Approach | Reason |
|-------|---------------------|--------|
| Claude Code | Subprocess per session | No server mode available |
| Codex | Subprocess per session | No server mode available |
| OpenCode | Shared server | Native server support, lower latency |
| Amp | Subprocess per session | No server mode available |

#### agent mode discovery

- **OpenCode**: discover via server API (see `client.app.agents()` in `research/agents/opencode.md`).
- **Codex**: no discovery; hardcode supported modes (behavior via prompt prefixes).
- **Claude Code**: no discovery; hardcode supported modes (behavior mostly via prompt/policy).
- **Amp**: no discovery; hardcode supported modes (typically just `build`).

#### installation

Before spawning, agents must be installed. **We curl raw binaries directly** - no npm, brew, install scripts, or other package managers.

##### Claude Code

```bash
# Get latest version
VERSION=$(curl -s https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest)

# Linux x64
curl -fsSL "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${VERSION}/linux-x64/claude" -o /usr/local/bin/claude && chmod +x /usr/local/bin/claude

# Linux x64 (musl)
curl -fsSL "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${VERSION}/linux-x64-musl/claude" -o /usr/local/bin/claude && chmod +x /usr/local/bin/claude

# Linux ARM64
curl -fsSL "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${VERSION}/linux-arm64/claude" -o /usr/local/bin/claude && chmod +x /usr/local/bin/claude

# macOS ARM64 (Apple Silicon)
curl -fsSL "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${VERSION}/darwin-arm64/claude" -o /usr/local/bin/claude && chmod +x /usr/local/bin/claude

# macOS x64 (Intel)
curl -fsSL "https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/${VERSION}/darwin-x64/claude" -o /usr/local/bin/claude && chmod +x /usr/local/bin/claude
```

##### Codex

```bash
# Linux x64 (musl for max compatibility)
curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-x86_64-unknown-linux-musl.tar.gz | tar -xz
mv codex-x86_64-unknown-linux-musl /usr/local/bin/codex

# Linux ARM64
curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-aarch64-unknown-linux-musl.tar.gz | tar -xz
mv codex-aarch64-unknown-linux-musl /usr/local/bin/codex

# macOS ARM64 (Apple Silicon)
curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-aarch64-apple-darwin.tar.gz | tar -xz
mv codex-aarch64-apple-darwin /usr/local/bin/codex

# macOS x64 (Intel)
curl -fsSL https://github.com/openai/codex/releases/latest/download/codex-x86_64-apple-darwin.tar.gz | tar -xz
mv codex-x86_64-apple-darwin /usr/local/bin/codex
```

##### OpenCode

```bash
# Linux x64
curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64.tar.gz | tar -xz
mv opencode /usr/local/bin/opencode

# Linux x64 (musl)
curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-x64-musl.tar.gz | tar -xz
mv opencode /usr/local/bin/opencode

# Linux ARM64
curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-arm64.tar.gz | tar -xz
mv opencode /usr/local/bin/opencode

# macOS ARM64 (Apple Silicon)
curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-darwin-arm64.zip -o opencode.zip && unzip -o opencode.zip && rm opencode.zip
mv opencode /usr/local/bin/opencode

# macOS x64 (Intel)
curl -fsSL https://github.com/anomalyco/opencode/releases/latest/download/opencode-darwin-x64.zip -o opencode.zip && unzip -o opencode.zip && rm opencode.zip
mv opencode /usr/local/bin/opencode
```

##### Amp

```bash
# Get latest version
VERSION=$(curl -s https://storage.googleapis.com/amp-public-assets-prod-0/cli/cli-version.txt)

# Linux x64
curl -fsSL "https://storage.googleapis.com/amp-public-assets-prod-0/cli/${VERSION}/amp-linux-x64" -o /usr/local/bin/amp && chmod +x /usr/local/bin/amp

# Linux ARM64
curl -fsSL "https://storage.googleapis.com/amp-public-assets-prod-0/cli/${VERSION}/amp-linux-arm64" -o /usr/local/bin/amp && chmod +x /usr/local/bin/amp

# macOS ARM64 (Apple Silicon)
curl -fsSL "https://storage.googleapis.com/amp-public-assets-prod-0/cli/${VERSION}/amp-darwin-arm64" -o /usr/local/bin/amp && chmod +x /usr/local/bin/amp

# macOS x64 (Intel)
curl -fsSL "https://storage.googleapis.com/amp-public-assets-prod-0/cli/${VERSION}/amp-darwin-x64" -o /usr/local/bin/amp && chmod +x /usr/local/bin/amp
```

##### binary URL summary

| Agent | Version URL | Binary URL Pattern |
|-------|-------------|-------------------|
| Claude Code | `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases/latest` | `.../{version}/{platform}/claude` |
| Codex | `https://api.github.com/repos/openai/codex/releases/latest` | `https://github.com/openai/codex/releases/latest/download/codex-{target}.tar.gz` |
| OpenCode | `https://api.github.com/repos/anomalyco/opencode/releases/latest` | `https://github.com/anomalyco/opencode/releases/latest/download/opencode-{platform}.tar.gz` |
| Amp | `https://storage.googleapis.com/amp-public-assets-prod-0/cli/cli-version.txt` | `.../{version}/amp-{platform}` |

##### platform mappings

| Platform | Claude Code | Codex | OpenCode | Amp |
|----------|-------------|-------|----------|-----|
| Linux x64 | `linux-x64` | `x86_64-unknown-linux-musl` | `linux-x64` | `linux-x64` |
| Linux x64 musl | `linux-x64-musl` | `x86_64-unknown-linux-musl` | `linux-x64-musl` | N/A |
| Linux ARM64 | `linux-arm64` | `aarch64-unknown-linux-musl` | `linux-arm64` | `linux-arm64` |
| macOS ARM64 | `darwin-arm64` | `aarch64-apple-darwin` | `darwin-arm64` | `darwin-arm64` |
| macOS x64 | `darwin-x64` | `x86_64-apple-darwin` | `darwin-x64` | `darwin-x64` |

##### versioning

| Agent | Get Latest Version | Specific Version |
|-------|-------------------|------------------|
| Claude Code | `curl -s https://storage.googleapis.com/claude-code-dist-.../latest` | Replace `${VERSION}` in URL |
| Codex | `curl -s https://api.github.com/repos/openai/codex/releases/latest \| jq -r .tag_name` | Replace `latest` with `download/{tag}` |
| OpenCode | `curl -s https://api.github.com/repos/anomalyco/opencode/releases/latest \| jq -r .tag_name` | Replace `latest` with `download/{tag}` |
| Amp | `curl -s https://storage.googleapis.com/amp-public-assets-prod-0/cli/cli-version.txt` | Replace `${VERSION}` in URL |

#### communication

**Subprocess mode (Claude Code, Codex, Amp):**
1. Spawn process with appropriate flags
2. Close stdin immediately after sending prompt (for single-turn) or keep open (for multi-turn)
3. Read JSONL events from stdout line-by-line
4. Parse each line as JSON and convert to `UniversalEvent`
5. Capture session/thread ID from events for resumption
6. Handle process exit/timeout

**Server mode (OpenCode):**
1. Ensure server is running (`opencode serve --port PORT`)
2. Create session via `POST /session`
3. Send prompts via `POST /session/{id}/prompt` (async version for streaming)
4. Subscribe to events via `GET /event/subscribe` (SSE)
5. Handle questions/permissions via dedicated endpoints
6. Session persists across multiple prompts

#### credential passing

| Agent | Env Var | Config File |
|-------|---------|-------------|
| Claude Code | `ANTHROPIC_API_KEY` | `~/.claude.json`, `~/.claude/.credentials.json` |
| Codex | `OPENAI_API_KEY` or `CODEX_API_KEY` | `~/.codex/auth.json` |
| OpenCode | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | `~/.local/share/opencode/auth.json` |
| Amp | `ANTHROPIC_API_KEY` | Uses Claude Code credentials |

When spawning subprocesses, pass the API key via environment variable. For OpenCode server mode, the server reads credentials from its config on startup.

### extract credentials

write a rust module for extracting credentials from the host machine. see bootstrap in ~/agent-jj. this will be used for tests

### testing

every agent needs to be tested for every possible feature of the universal api

that means we need to build a test suite that can be ran on any agent

then run them on every agent

this machine is already authenticated with codex & claude & opencode (for codex). not amp yet. use the extract credentials module to get the credentials for this test. in order to test things like quetions, etc, the test should prompt the agent with a very specific prompt that should give a very specific response. do not mock anything.

## testing frontend

in frontend/packages/inspector/ build a vite + react app that:

- connect screen: prompts the user to provide an endpoint & optional token
    - shows instructions on how to run the sandbox-agent (including cors)
    - if gets error or cors error, instruct the user to ensure they have cors flags enabled
- agent screen: provides a full agent ui covering all of the features. also includes a log of all http requests in the ui with a copy button for the curl command

## component: sdks

we need to auto-generate types from our json schema for these languages

- typescript sdk
    - expose our http api as a typescript sdk
    - update claude.md to specify that when changing api, we need to update the typescript sdk + the cli to interact with it
    - impelment two main entrypoint: connect to endpoint + token or run locally (which spawns this binary as a subprocess, add todo to set up release pipeline and auto-pull the binary)

### typescript sdk approach

Use OpenAPI (from utoipa) + `openapi-typescript` to generate types, and implement a thin custom client wrapper (fetch-based) around the generated types. Avoid full client generators to keep the output small and stable.

## examples

build typescript examples of how to deploy this to the given providres:

- docker
- e2b
- daytona
- vercel sandboxes
- cloudflare sandboxes

these should each have a vitest unit test to test. cloudflaer is trickier since it requires a more complex setup.

## docs

Docs live in the `docs/` folder (Mintlify). The root `README.md` should stay brief and link to the docs site or local docs.

Write docs that cover:

- architecture
- agent compatibility
- deployment guide (link to working examples)
    - docker (for dev)
    - e2b
    - daytona
    - vercel sandboxes
    - cloudflare sandboxes
- universal agent api feature checklist
    - questions
    - approve plan
    - etc (infer what features are required vs optional)
- cli
- http api
- running the example frontend
- typescript sdk

Use collapsible sections for each API endpoint or TypeScript SDK endpoint to keep the page readable.
