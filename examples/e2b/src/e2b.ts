import { Sandbox } from "@e2b/code-interpreter";
import { SandboxAgent } from "sandbox-agent";
import { logInspectorUrl, runPrompt } from "@sandbox-agent/example-shared";

if (!process.env.E2B_API_KEY || (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY)) {
  throw new Error("E2B_API_KEY and (OPENAI_API_KEY or ANTHROPIC_API_KEY) required");
}

const envs: Record<string, string> = {};
if (process.env.ANTHROPIC_API_KEY) envs.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENAI_API_KEY) envs.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sandbox = await Sandbox.create({ allowInternetAccess: true, envs });

const run = (cmd: string) => sandbox.commands.run(cmd);

console.log("Installing sandbox-agent...");
await run("curl -fsSL https://releases.rivet.dev/sandbox-agent/latest/install.sh | sh");

console.log("Starting server...");
await sandbox.commands.run("sandbox-agent server --no-token --host 0.0.0.0 --port 3000", { background: true });

const baseUrl = `https://${sandbox.getHost(3000)}`;
logInspectorUrl({ baseUrl });

// Wait for server to be ready
console.log("Waiting for server...");
const client = await SandboxAgent.connect({ baseUrl });
for (let i = 0; i < 30; i++) {
  try {
    await client.getHealth();
    break;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}

console.log("Installing agents...");
await client.installAgent("claude");
await client.installAgent("codex");

const cleanup = async () => {
  console.log("Cleaning up...");
  await sandbox.kill();
  process.exit(0);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);

await runPrompt({ baseUrl });
await cleanup();
