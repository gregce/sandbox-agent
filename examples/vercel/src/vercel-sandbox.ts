import { Sandbox } from "@vercel/sandbox";
import { logInspectorUrl, runPrompt, waitForHealth } from "@sandbox-agent/example-shared";

if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("OPENAI_API_KEY or ANTHROPIC_API_KEY required");
}

const PORT = 3000;

const sandbox = await Sandbox.create({
  runtime: process.env.VERCEL_RUNTIME || "node24",
  ports: [PORT],
  ...(process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID
    ? { token: process.env.VERCEL_TOKEN, teamId: process.env.VERCEL_TEAM_ID, projectId: process.env.VERCEL_PROJECT_ID }
    : {}),
});

const run = (cmd: string) => sandbox.runCommand({ cmd: "bash", args: ["-lc", cmd], sudo: true });

console.log("Installing sandbox-agent...");
await run("curl -fsSL https://releases.rivet.dev/sandbox-agent/latest/install.sh | sh");
await run("sandbox-agent install-agent claude");
await run("sandbox-agent install-agent codex");

console.log("Starting server...");
await sandbox.runCommand({
  cmd: "bash",
  args: ["-lc", `sandbox-agent server --no-token --host 0.0.0.0 --port ${PORT}`],
  sudo: true,
  detached: true,
});

const baseUrl = `https://${sandbox.domain(PORT)}`;
await waitForHealth({ baseUrl });
logInspectorUrl({ baseUrl });

const cleanup = async () => {
  console.log("Cleaning up...");
  await sandbox.stop();
  process.exit(0);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);

await runPrompt({ baseUrl });
await cleanup();
