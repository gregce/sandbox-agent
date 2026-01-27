import * as path from "node:path";
import { $ } from "execa";
import type { ReleaseOpts } from "./main";
import { assertDirExists, PREFIX, uploadDirToReleases } from "./utils";

export async function buildJsArtifacts(opts: ReleaseOpts) {
	await buildAndUploadTypescriptSdk(opts);
}

async function buildAndUploadTypescriptSdk(opts: ReleaseOpts) {
	console.log(`==> Building TypeScript SDK`);

	// Build TypeScript SDK
	// SANDBOX_AGENT_SKIP_INSPECTOR=1 skips building inspector frontend for openapi-gen
	await $({
		stdio: "inherit",
		cwd: opts.root,
		env: { ...process.env, SANDBOX_AGENT_SKIP_INSPECTOR: "1" },
	})`pnpm --filter sandbox-agent build`;

	console.log(`✅ TypeScript SDK built successfully`);

	// Upload TypeScript SDK to R2
	console.log(`==> Uploading TypeScript SDK Artifacts`);

	const sdkDistPath = path.resolve(
		opts.root,
		"sdks/typescript/dist",
	);

	await assertDirExists(sdkDistPath);

	// Upload to commit directory
	console.log(`Uploading TypeScript SDK to ${PREFIX}/${opts.commit}/typescript/`);
	await uploadDirToReleases(sdkDistPath, `${PREFIX}/${opts.commit}/typescript/`);

	console.log(`✅ TypeScript SDK artifacts uploaded successfully`);
}
