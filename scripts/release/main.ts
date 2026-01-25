#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";

const ENDPOINT_URL =
  "https://2a94c6a0ced8d35ea63cddc86c2681e7.r2.cloudflarestorage.com";
const BUCKET = "rivet-releases";
const PREFIX = "sandbox-agent";

const BINARY_FILES = [
  "sandbox-agent-x86_64-unknown-linux-musl",
  "sandbox-agent-x86_64-pc-windows-gnu.exe",
  "sandbox-agent-x86_64-apple-darwin",
  "sandbox-agent-aarch64-apple-darwin",
];

const CRATE_ORDER = [
  "error",
  "agent-credentials",
  "agent-schema",
  "universal-agent-schema",
  "agent-management",
  "sandbox-agent",
];

const PLATFORM_MAP: Record<string, { pkg: string; os: string; cpu: string; ext: string }> = {
  "x86_64-unknown-linux-musl": { pkg: "linux-x64", os: "linux", cpu: "x64", ext: "" },
  "x86_64-pc-windows-gnu": { pkg: "win32-x64", os: "win32", cpu: "x64", ext: ".exe" },
  "x86_64-apple-darwin": { pkg: "darwin-x64", os: "darwin", cpu: "x64", ext: "" },
  "aarch64-apple-darwin": { pkg: "darwin-arm64", os: "darwin", cpu: "arm64", ext: "" },
};

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    if (arg.includes("=")) {
      const [key, value] = arg.split("=");
      args.set(key, value ?? "");
      continue;
    }
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(arg, next);
      i += 1;
    } else {
      flags.add(arg);
    }
  }
  return { args, flags };
}

function run(cmd: string, cmdArgs: string[], options: Record<string, any> = {}) {
  const result = spawnSync(cmd, cmdArgs, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runCapture(
  cmd: string,
  cmdArgs: string[],
  options: Record<string, any> = {},
) {
  const result = spawnSync(cmd, cmdArgs, {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ? String(result.stderr).trim() : "";
    throw new Error(`${cmd} failed: ${stderr}`);
  }
  return (result.stdout || "").toString().trim();
}

interface ParsedSemver {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

function parseSemver(version: string): ParsedSemver {
  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/,
  );
  if (!match) {
    throw new Error(`Invalid semantic version: ${version}`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : [],
  };
}

function compareSemver(a: ParsedSemver, b: ParsedSemver) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

function isStable(version: string) {
  return parseSemver(version).prerelease.length === 0;
}

function getAllGitVersions() {
  try {
    execFileSync("git", ["fetch", "--tags", "--force", "--quiet"], {
      stdio: "ignore",
    });
  } catch {
    // best-effort
  }

  const output = runCapture("git", ["tag", "-l", "v*"]);
  if (!output) return [];

  return output
    .split("\n")
    .map((tag) => tag.replace(/^v/, ""))
    .filter((tag) => {
      try {
        parseSemver(tag);
        return true;
      } catch {
        return false;
      }
    })
    .sort((a, b) => compareSemver(parseSemver(b), parseSemver(a)));
}

function getLatestStableVersion() {
  const versions = getAllGitVersions();
  const stable = versions.filter((version) => isStable(version));
  return stable[0] || null;
}

function shouldTagAsLatest(version: string) {
  const parsed = parseSemver(version);
  if (parsed.prerelease.length > 0) {
    return false;
  }

  const latestStable = getLatestStableVersion();
  if (!latestStable) {
    return true;
  }

  return compareSemver(parsed, parseSemver(latestStable)) > 0;
}

function getAwsEnv() {
  const accessKey =
    process.env.AWS_ACCESS_KEY_ID || process.env.R2_RELEASES_ACCESS_KEY_ID;
  const secretKey =
    process.env.AWS_SECRET_ACCESS_KEY ||
    process.env.R2_RELEASES_SECRET_ACCESS_KEY;

  if (!accessKey || !secretKey) {
    throw new Error("Missing AWS credentials for releases bucket");
  }

  return {
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: "auto",
  };
}

function uploadDir(localPath: string, remotePath: string) {
  const env = { ...process.env, ...getAwsEnv() };
  run(
    "aws",
    [
      "s3",
      "cp",
      localPath,
      `s3://${BUCKET}/${remotePath}`,
      "--recursive",
      "--checksum-algorithm",
      "CRC32",
      "--endpoint-url",
      ENDPOINT_URL,
    ],
    { env },
  );
}

function uploadFile(localPath: string, remotePath: string) {
  const env = { ...process.env, ...getAwsEnv() };
  run(
    "aws",
    [
      "s3",
      "cp",
      localPath,
      `s3://${BUCKET}/${remotePath}`,
      "--checksum-algorithm",
      "CRC32",
      "--endpoint-url",
      ENDPOINT_URL,
    ],
    { env },
  );
}

function uploadContent(content: string, remotePath: string) {
  const env = { ...process.env, ...getAwsEnv() };
  const result = spawnSync(
    "aws",
    [
      "s3",
      "cp",
      "-",
      `s3://${BUCKET}/${remotePath}`,
      "--endpoint-url",
      ENDPOINT_URL,
    ],
    {
      env,
      input: content,
      stdio: ["pipe", "inherit", "inherit"],
    },
  );
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function buildTypescript(rootDir: string) {
  const sdkDir = path.join(rootDir, "sdks", "typescript");
  if (!fs.existsSync(sdkDir)) {
    throw new Error(`TypeScript SDK not found at ${sdkDir}`);
  }
  run("npm", ["install"], { cwd: sdkDir });
  run("npm", ["run", "build"], { cwd: sdkDir });
  return path.join(sdkDir, "dist");
}

function uploadTypescriptArtifacts(rootDir: string, version: string, latest: boolean) {
  console.log("==> Building TypeScript SDK");
  const distPath = buildTypescript(rootDir);

  console.log("==> Uploading TypeScript artifacts");
  uploadDir(distPath, `${PREFIX}/${version}/typescript/`);
  if (latest) {
    uploadDir(distPath, `${PREFIX}/latest/typescript/`);
  }
}

function uploadInstallScript(rootDir: string, version: string, latest: boolean) {
  const installPath = path.join(
    rootDir,
    "scripts",
    "release",
    "static",
    "install.sh",
  );
  let installContent = fs.readFileSync(installPath, "utf8");

  const uploadForVersion = (versionValue: string, remoteVersion: string) => {
    const content = installContent.replace(/__VERSION__/g, versionValue);
    uploadContent(content, `${PREFIX}/${remoteVersion}/install.sh`);
  };

  uploadForVersion(version, version);
  if (latest) {
    uploadForVersion("latest", "latest");
  }
}

function uploadBinaries(rootDir: string, version: string, latest: boolean) {
  const distDir = path.join(rootDir, "dist");
  if (!fs.existsSync(distDir)) {
    throw new Error(`dist directory not found at ${distDir}`);
  }

  for (const fileName of BINARY_FILES) {
    const localPath = path.join(distDir, fileName);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Missing binary: ${localPath}`);
    }

    uploadFile(localPath, `${PREFIX}/${version}/${fileName}`);
    if (latest) {
      uploadFile(localPath, `${PREFIX}/latest/${fileName}`);
    }
  }
}

// Pre-release checks
function runChecks(rootDir: string) {
  console.log("==> Running Rust checks");
  run("cargo", ["fmt", "--all", "--", "--check"], { cwd: rootDir });
  run("cargo", ["clippy", "--all-targets", "--", "-D", "warnings"], { cwd: rootDir });
  run("cargo", ["test", "--all-targets"], { cwd: rootDir });

  console.log("==> Running TypeScript checks");
  run("pnpm", ["install"], { cwd: rootDir });
  run("pnpm", ["run", "build"], { cwd: rootDir });
}

// Crates.io publishing
function publishCrates(rootDir: string, version: string) {
  // Update workspace version
  const cargoPath = path.join(rootDir, "Cargo.toml");
  let cargoContent = fs.readFileSync(cargoPath, "utf8");
  cargoContent = cargoContent.replace(/^version = ".*"/m, `version = "${version}"`);
  fs.writeFileSync(cargoPath, cargoContent);

  for (const crate of CRATE_ORDER) {
    console.log(`==> Publishing sandbox-agent-${crate}`);
    const crateDir = path.join(rootDir, "engine", "packages", crate);
    run("cargo", ["publish", "--allow-dirty"], { cwd: crateDir });
    // Wait for crates.io index propagation
    console.log("Waiting 30s for index...");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);
  }
}

// npm SDK publishing
function publishNpmSdk(rootDir: string, version: string) {
  const sdkDir = path.join(rootDir, "sdks", "typescript");
  console.log("==> Publishing TypeScript SDK to npm");
  run("npm", ["version", version, "--no-git-tag-version"], { cwd: sdkDir });
  run("pnpm", ["install"], { cwd: sdkDir });
  run("pnpm", ["run", "build"], { cwd: sdkDir });
  run("npm", ["publish", "--access", "public"], { cwd: sdkDir });
}

// npm CLI publishing
function publishNpmCli(rootDir: string, version: string) {
  const cliDir = path.join(rootDir, "sdks", "cli");
  const distDir = path.join(rootDir, "dist");

  // Publish platform packages first
  for (const [target, info] of Object.entries(PLATFORM_MAP)) {
    const platformDir = path.join(cliDir, "platforms", info.pkg);
    const binDir = path.join(platformDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });

    // Copy binary
    const srcBinary = path.join(distDir, `sandbox-agent-${target}${info.ext}`);
    const dstBinary = path.join(binDir, `sandbox-agent${info.ext}`);
    fs.copyFileSync(srcBinary, dstBinary);
    if (info.ext !== ".exe") fs.chmodSync(dstBinary, 0o755);

    // Update version and publish
    console.log(`==> Publishing @sandbox-agent/cli-${info.pkg}`);
    run("npm", ["version", version, "--no-git-tag-version"], { cwd: platformDir });
    run("npm", ["publish", "--access", "public"], { cwd: platformDir });
  }

  // Publish main package (update optionalDeps versions)
  console.log("==> Publishing @sandbox-agent/cli");
  const pkgPath = path.join(cliDir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  for (const dep of Object.keys(pkg.optionalDependencies || {})) {
    pkg.optionalDependencies[dep] = version;
  }
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  run("npm", ["publish", "--access", "public"], { cwd: cliDir });
}

function main() {
  const { args, flags } = parseArgs(process.argv.slice(2));
  const versionArg = args.get("--version");
  if (!versionArg) {
    console.error("--version is required");
    process.exit(1);
  }

  const version = versionArg.replace(/^v/, "");
  parseSemver(version);

  let latest: boolean;
  if (flags.has("--latest")) {
    latest = true;
  } else if (flags.has("--no-latest")) {
    latest = false;
  } else {
    latest = shouldTagAsLatest(version);
  }

  const outputPath = args.get("--output");
  if (flags.has("--print-latest")) {
    if (outputPath) {
      fs.appendFileSync(outputPath, `latest=${latest}\n`);
    } else {
      process.stdout.write(latest ? "true" : "false");
    }
  }

  if (flags.has("--check")) {
    runChecks(process.cwd());
  }

  if (flags.has("--publish-crates")) {
    publishCrates(process.cwd(), version);
  }

  if (flags.has("--publish-npm-sdk")) {
    publishNpmSdk(process.cwd(), version);
  }

  if (flags.has("--publish-npm-cli")) {
    publishNpmCli(process.cwd(), version);
  }

  if (flags.has("--upload-typescript")) {
    uploadTypescriptArtifacts(process.cwd(), version, latest);
  }

  if (flags.has("--upload-install")) {
    uploadInstallScript(process.cwd(), version, latest);
  }

  if (flags.has("--upload-binaries")) {
    uploadBinaries(process.cwd(), version, latest);
  }
}

main();
