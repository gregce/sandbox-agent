import { createInterface } from "node:readline/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { SandboxAgent } from "sandbox-agent";

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function ensureUrl(rawUrl: string): string {
  if (!rawUrl) {
    throw new Error("Missing sandbox URL");
  }
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  return `https://${rawUrl}`;
}

const INSPECTOR_URL = "https://inspect.sandboxagent.dev";

export function buildInspectorUrl({
  baseUrl,
  token,
  headers,
}: {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
}): string {
  const normalized = normalizeBaseUrl(ensureUrl(baseUrl));
  const params = new URLSearchParams({ url: normalized });
  if (token) {
    params.set("token", token);
  }
  if (headers && Object.keys(headers).length > 0) {
    params.set("headers", JSON.stringify(headers));
  }
  return `${INSPECTOR_URL}?${params.toString()}`;
}

export function logInspectorUrl({
  baseUrl,
  token,
  headers,
}: {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
}): void {
  console.log(`Inspector: ${buildInspectorUrl({ baseUrl, token, headers })}`);
}

type HeaderOptions = {
  token?: string;
  extraHeaders?: Record<string, string>;
  contentType?: boolean;
};

export function buildHeaders({ token, extraHeaders, contentType = false }: HeaderOptions): HeadersInit {
  const headers: Record<string, string> = {
    ...(extraHeaders || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (contentType) {
    headers["Content-Type"] = "application/json";
  }
  return headers;
}

async function fetchJson(
  url: string,
  {
    token,
    extraHeaders,
    method = "GET",
    body,
  }: {
    token?: string;
    extraHeaders?: Record<string, string>;
    method?: string;
    body?: unknown;
  } = {}
): Promise<any> {
  const headers = buildHeaders({
    token,
    extraHeaders,
    contentType: body !== undefined,
  });
  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function waitForHealth({
  baseUrl,
  token,
  extraHeaders,
  timeoutMs = 120_000,
}: {
  baseUrl: string;
  token?: string;
  extraHeaders?: Record<string, string>;
  timeoutMs?: number;
}): Promise<void> {
  const normalized = normalizeBaseUrl(baseUrl);
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const data = await fetchJson(`${normalized}/v1/health`, { token, extraHeaders });
      if (data?.status === "ok") {
        return;
      }
      lastError = new Error(`Unexpected health response: ${JSON.stringify(data)}`);
    } catch (error) {
      lastError = error;
    }
    await delay(500);
  }
  throw (lastError ?? new Error("Timed out waiting for /v1/health")) as Error;
}

export async function createSession({
  baseUrl,
  token,
  extraHeaders,
  agentId,
  agentMode,
  permissionMode,
  model,
  variant,
  agentVersion,
}: {
  baseUrl: string;
  token?: string;
  extraHeaders?: Record<string, string>;
  agentId?: string;
  agentMode?: string;
  permissionMode?: string;
  model?: string;
  variant?: string;
  agentVersion?: string;
}): Promise<string> {
  const normalized = normalizeBaseUrl(baseUrl);
  const sessionId = randomUUID();
  const body: Record<string, string> = {
    agent: agentId || process.env.SANDBOX_AGENT || "claude",
  };
  const envAgentMode = agentMode || process.env.SANDBOX_AGENT_MODE;
  const envPermissionMode = permissionMode || process.env.SANDBOX_PERMISSION_MODE;
  const envModel = model || process.env.SANDBOX_MODEL;
  const envVariant = variant || process.env.SANDBOX_VARIANT;
  const envAgentVersion = agentVersion || process.env.SANDBOX_AGENT_VERSION;

  if (envAgentMode) body.agentMode = envAgentMode;
  if (envPermissionMode) body.permissionMode = envPermissionMode;
  if (envModel) body.model = envModel;
  if (envVariant) body.variant = envVariant;
  if (envAgentVersion) body.agentVersion = envAgentVersion;

  await fetchJson(`${normalized}/v1/sessions/${sessionId}`, {
    token,
    extraHeaders,
    method: "POST",
    body,
  });
  return sessionId;
}

function extractTextFromItem(item: any): string {
  if (!item?.content) return "";
  const textParts = item.content
    .filter((part: any) => part?.type === "text")
    .map((part: any) => part.text || "")
    .join("");
  if (textParts.trim()) {
    return textParts;
  }
  return JSON.stringify(item.content, null, 2);
}

export async function sendMessageStream({
  baseUrl,
  token,
  extraHeaders,
  sessionId,
  message,
  onText,
}: {
  baseUrl: string;
  token?: string;
  extraHeaders?: Record<string, string>;
  sessionId: string;
  message: string;
  onText?: (text: string) => void;
}): Promise<string> {
  const normalized = normalizeBaseUrl(baseUrl);
  const headers = buildHeaders({ token, extraHeaders, contentType: true });

  const response = await fetch(`${normalized}/v1/sessions/${sessionId}/messages/stream`, {
    method: "POST",
    headers,
    body: JSON.stringify({ message }),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status} ${response.statusText}: ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;

      try {
        const event = JSON.parse(data);

        // Handle text deltas (delta can be a string or an object with type: "text")
        if (event.type === "item.delta" && event.data?.delta) {
          const delta = event.data.delta;
          const text = typeof delta === "string" ? delta : delta.type === "text" ? delta.text || "" : "";
          if (text) {
            fullText += text;
            onText?.(text);
          }
        }

        // Handle completed assistant message
        if (
          event.type === "item.completed" &&
          event.data?.item?.kind === "message" &&
          event.data?.item?.role === "assistant"
        ) {
          const itemText = extractTextFromItem(event.data.item);
          if (itemText && !fullText) {
            fullText = itemText;
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  }

  return fullText;
}

export async function runPrompt({
  baseUrl,
  token,
  extraHeaders,
  agentId,
}: {
  baseUrl: string;
  token?: string;
  extraHeaders?: Record<string, string>;
  agentId?: string;
}): Promise<void> {
  const client = await SandboxAgent.connect({
    baseUrl,
    token,
    headers: extraHeaders,
  });

  const sessionId = randomUUID();
  await client.createSession(sessionId, {
    agent: agentId || process.env.SANDBOX_AGENT || "claude",
  });
  console.log(`Session ${sessionId} ready. Press Ctrl+C to quit.`);

  let isThinking = false;
  let hasStartedOutput = false;
  let turnResolve: (() => void) | null = null;
  let sessionEnded = false;

  // Stream events in background using SDK
  const processEvents = async () => {
    for await (const event of client.streamEvents(sessionId)) {
      // Show thinking indicator when assistant starts
      if (event.type === "item.started") {
        const item = (event.data as any)?.item;
        if (item?.role === "assistant") {
          isThinking = true;
          hasStartedOutput = false;
          process.stdout.write("Thinking...");
        }
      }

      // Print text deltas
      if (event.type === "item.delta") {
        const delta = (event.data as any)?.delta;
        if (delta) {
          if (isThinking && !hasStartedOutput) {
            process.stdout.write("\r\x1b[K"); // Clear line
            hasStartedOutput = true;
          }
          const text = typeof delta === "string" ? delta : delta.type === "text" ? delta.text || "" : "";
          if (text) process.stdout.write(text);
        }
      }

      // Signal turn complete
      if (event.type === "item.completed") {
        const item = (event.data as any)?.item;
        if (item?.role === "assistant") {
          isThinking = false;
          process.stdout.write("\n");
          turnResolve?.();
          turnResolve = null;
        }
      }

      // Handle session ended
      if (event.type === "session.ended") {
        const data = event.data as any;
        console.log(`Agent Process Exited${data?.reason ? `: ${data.reason}` : ""}`);
        sessionEnded = true;
        turnResolve?.();
        turnResolve = null;
      }
    }
  };
  processEvents().catch((err) => {
    if (!sessionEnded) {
      console.error("Event stream error:", err instanceof Error ? err.message : err);
    }
  });

  // Read user input and post messages
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  while (true) {
    const line = await rl.question("> ");
    if (!line.trim()) continue;

    const turnComplete = new Promise<void>((resolve) => {
      turnResolve = resolve;
    });

    try {
      await client.postMessage(sessionId, { message: line.trim() });
      await turnComplete;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      turnResolve = null;
    }
  }
}
