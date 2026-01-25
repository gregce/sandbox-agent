# Contributing

Documentation lives in `docs/` (Mintlify). Start with:

- `docs/index.mdx` for the overview
- `docs/quickstart.mdx` to run the daemon
- `docs/http-api.mdx` and `docs/cli.mdx` for API references

Quickstart (local dev):

```bash
sandbox-agent --token "$SANDBOX_TOKEN" --host 127.0.0.1 --port 2468
```

Extract API keys from local agent configs (Claude Code, Codex, OpenCode, Amp):

```bash
# Print env vars
sandbox-agent credentials extract-env

# Export to current shell
eval "$(sandbox-agent credentials extract-env --export)"
```

Run the web console (includes all dependencies):

```bash
pnpm dev -F @sandbox-agent/inspector
```

