import { Daytona, Image } from "@daytonaio/sdk";
import { logInspectorUrl, runPrompt } from "@sandbox-agent/example-shared";

if (
	!process.env.DAYTONA_API_KEY ||
	(!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY)
) {
	throw new Error(
		"DAYTONA_API_KEY and (OPENAI_API_KEY or ANTHROPIC_API_KEY) required",
	);
}

const SNAPSHOT = "sandbox-agent-ready";
const BINARY = "/usr/local/bin/sandbox-agent";

const daytona = new Daytona();

const hasSnapshot = await daytona.snapshot.get(SNAPSHOT).then(
	() => true,
	() => false,
);
if (!hasSnapshot) {
	console.log(`Creating snapshot '${SNAPSHOT}' (one-time setup, ~2-3min)...`);
	await daytona.snapshot.create(
		{
			name: SNAPSHOT,
			image: Image.base("ubuntu:22.04").runCommands(
				// Install dependencies
				"apt-get update && apt-get install -y curl ca-certificates",
				// Install sandbox-agent via install script
				"curl -fsSL https://releases.rivet.dev/sandbox-agent/latest/install.sh | sh",
				// Pre-install agents using sandbox-agent CLI
				"sandbox-agent install-agent claude",
				"sandbox-agent install-agent codex",
			),
		},
		{ onLogs: (log) => console.log(`  ${log}`) },
	);
	console.log("Snapshot created. Future runs will be instant.");
}

console.log("Creating sandbox...");
const envVars: Record<string, string> = {};
if (process.env.ANTHROPIC_API_KEY) envVars.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (process.env.OPENAI_API_KEY) envVars.OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const sandbox = await daytona.create({
	snapshot: SNAPSHOT,
	envVars,
	autoStopInterval: 0,
});

console.log("Starting server...");
await sandbox.process.executeCommand(
	`nohup ${BINARY} server --no-token --host 0.0.0.0 --port 3000 >/tmp/sandbox-agent.log 2>&1 &`,
);

const baseUrl = (await sandbox.getSignedPreviewUrl(3000, 4 * 60 * 60)).url;
logInspectorUrl({ baseUrl });

const cleanup = async () => {
	console.log("Cleaning up...");
	await sandbox.delete(60);
	process.exit(0);
};
process.once("SIGINT", cleanup);
process.once("SIGTERM", cleanup);

await runPrompt({ baseUrl });
await cleanup();
