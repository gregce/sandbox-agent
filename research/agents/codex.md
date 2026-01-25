# Codex Research

Research notes on OpenAI Codex's configuration, credential discovery, and runtime behavior based on agent-jj implementation.

## Overview

- **Provider**: OpenAI
- **Execution Method**: SDK (`@openai/codex-sdk`) or CLI binary
- **Session Persistence**: Thread ID (string)
- **Import**: Dynamic import to avoid bundling issues
- **Binary Location**: `~/.nvm/versions/node/v24.3.0/bin/codex` (npm global install)

## SDK Architecture

**The SDK wraps a bundled binary** - it does NOT make direct API calls.

- The TypeScript SDK includes a pre-compiled Codex binary
- When you use the SDK, it spawns this binary as a child process
- Communication happens via stdin/stdout using JSONL (JSON Lines) format
- The binary itself handles the actual communication with OpenAI's backend services

Sources: [Codex SDK docs](https://developers.openai.com/codex/sdk/), [GitHub](https://github.com/openai/codex)

## CLI Usage (Alternative to SDK)

You can use the `codex` binary directly instead of the SDK:

### Interactive Mode
```bash
codex "your prompt here"
codex --model o3 "your prompt"
```

### Non-Interactive Mode (`codex exec`)
```bash
codex exec "your prompt here"
codex exec --json "your prompt"  # JSONL output
codex exec -m o3 "your prompt"
codex exec --dangerously-bypass-approvals-and-sandbox "prompt"
codex exec resume --last  # Resume previous session
```

### Key CLI Flags
| Flag | Description |
|------|-------------|
| `--json` | Print events to stdout as JSONL |
| `-m, --model MODEL` | Model to use |
| `-s, --sandbox MODE` | `read-only`, `workspace-write`, `danger-full-access` |
| `--full-auto` | Auto-approve with workspace-write sandbox |
| `--dangerously-bypass-approvals-and-sandbox` | Skip all prompts (dangerous) |
| `-C, --cd DIR` | Working directory |
| `-o, --output-last-message FILE` | Write final response to file |
| `--output-schema FILE` | JSON Schema for structured output |

### Session Management
```bash
codex resume          # Pick from previous sessions
codex resume --last   # Resume most recent
codex fork --last     # Fork most recent session
```

## Credential Discovery

### Priority Order

1. User-configured credentials (from `credentials` array)
2. Environment variable: `CODEX_API_KEY`
3. Environment variable: `OPENAI_API_KEY`
4. Bootstrap extraction from config files

### Config File Location

| Path | Description |
|------|-------------|
| `~/.codex/auth.json` | Primary auth config |

### Auth File Structure

```json
// API Key authentication
{
  "OPENAI_API_KEY": "sk-..."
}

// OAuth authentication
{
  "tokens": {
    "access_token": "..."
  }
}
```

## SDK Usage

### Client Initialization

```typescript
import { Codex } from "@openai/codex-sdk";

// With API key
const codex = new Codex({ apiKey: "sk-..." });

// Without API key (uses default auth)
const codex = new Codex();
```

Dynamic import is used to avoid bundling the SDK:
```typescript
const { Codex } = await import("@openai/codex-sdk");
```

### Thread Management

```typescript
// Start new thread
const thread = codex.startThread();

// Resume existing thread
const thread = codex.resumeThread(threadId);
```

### Running Prompts

```typescript
const { events } = await thread.runStreamed(prompt);

for await (const event of events) {
  // Process events
}
```

## Event Types

| Event Type | Description |
|------------|-------------|
| `thread.started` | Thread initialized, contains `thread_id` |
| `item.completed` | Item finished, check for `agent_message` type |
| `turn.failed` | Turn failed with error message |

### Event Structure

```typescript
// thread.started
{
  type: "thread.started",
  thread_id: "thread_abc123"
}

// item.completed (agent message)
{
  type: "item.completed",
  item: {
    type: "agent_message",
    text: "Response text"
  }
}

// turn.failed
{
  type: "turn.failed",
  error: {
    message: "Error description"
  }
}
```

## Response Schema

```typescript
// CodexRunResultSchema
type CodexRunResult = string | {
  result?: string;
  output?: string;
  message?: string;
  // ...additional fields via passthrough
};
```

Content is extracted in priority order: `result` > `output` > `message`

## Thread ID Retrieval

Thread ID can be obtained from multiple sources:

1. `thread.started` event's `thread_id` property
2. Thread object's `id` getter (after first turn)
3. Thread object's `threadId` or `_id` properties (fallbacks)

```typescript
function getThreadId(thread: unknown): string | null {
  const value = thread as { id?: string; threadId?: string; _id?: string };
  return value.id ?? value.threadId ?? value._id ?? null;
}
```

## Agent Modes vs Permission Modes

Codex separates sandbox levels (permissions) from behavioral modes (prompt prefixes).

### Permission Modes (Sandbox Levels)

| Mode | CLI Flag | Behavior |
|------|----------|----------|
| `read-only` | `-s read-only` | No file modifications |
| `workspace-write` | `-s workspace-write` | Can modify workspace files |
| `danger-full-access` | `-s danger-full-access` | Full system access |
| `bypass` | `--dangerously-bypass-approvals-and-sandbox` | Skip all checks |

### Agent Modes (Prompt Prefixes)

Codex doesn't have true agent modes - behavior is controlled via prompt prefixing:

| Mode | Prompt Prefix |
|------|---------------|
| `build` | No prefix (default) |
| `plan` | `"Make a plan before acting.\n\n"` |
| `chat` | `"Answer conversationally.\n\n"` |

```typescript
function withModePrefix(prompt: string, mode: AgentMode): string {
  if (mode === "plan") {
    return `Make a plan before acting.\n\n${prompt}`;
  }
  if (mode === "chat") {
    return `Answer conversationally.\n\n${prompt}`;
  }
  return prompt;
}
```

### Human-in-the-Loop

Codex has no interactive HITL in SDK mode. All permissions must be configured upfront via sandbox level.

## Error Handling

- `turn.failed` events are captured but don't throw
- Thread ID is still returned on error for potential resumption
- Events iterator may throw after errors - caught and logged

```typescript
interface CodexPromptResult {
  result: unknown;
  threadId?: string | null;
  error?: string;  // Set if turn failed
}
```

## Conversion to Universal Format

Codex output is converted via `convertCodexOutput()`:

1. Parse with `CodexRunResultSchema`
2. If result is string, use directly
3. Otherwise extract from `result`, `output`, or `message` fields
4. Wrap as assistant message entry

## Session Continuity

- Thread ID persists across prompts
- Use `resumeThread(threadId)` to continue conversation
- Thread ID is captured from `thread.started` event or thread object

## Notes

- SDK is dynamically imported to reduce bundle size
- No explicit timeout (relies on SDK defaults)
- Thread ID may not be available until first event
- Error messages are preserved for debugging
- Working directory is not explicitly set (SDK handles internally)
