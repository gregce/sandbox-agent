import { Sandbox } from "@e2b/code-interpreter";
import { logInspectorUrl, runPrompt } from "@sandbox-agent/example-shared";

if (!process.env.E2B_API_KEY || (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY)) {
  throw new Error("E2B_API_KEY and (OPENAI_API_KEY or ANTHROPIC_API_KEY) required");
}

const sandbox = await Sandbox.create({ allowInternetAccess: true });

const run = (cmd: string) => sandbox.commands.run(cmd);

console.log("Installing sandbox-agent...");
await run("curl -fsSL https://releases.rivet.dev/sandbox-agent/latest/install.sh | sh");
await run("sandbox-agent install-agent claude");
await run("sandbox-agent install-agent codex");

console.log("Starting server...");
await sandbox.commands.run("sandbox-agent server --no-token --host 0.0.0.0 --port 3000", { background: true });

const baseUrl = `https://${sandbox.getHost(3000)}`;
logInspectorUrl({ baseUrl });

const cleanup = async () => {
  console.log("Cleaning up...");
  await sandbox.kill();
  process.exit(0);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);

await runPrompt({ baseUrl });
await cleanup();
