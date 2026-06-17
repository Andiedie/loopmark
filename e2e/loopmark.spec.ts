import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import worker, { type WorkerEnv } from "../src/server/worker";

class MemoryR2Object {
  constructor(private readonly value: string) {}

  async text(): Promise<string> {
    return this.value;
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, string>();

  async get(key: string): Promise<MemoryR2Object | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : new MemoryR2Object(value);
  }

  async put(key: string, value: string, options?: { onlyIf?: { etagDoesNotMatch?: string } }): Promise<unknown | null> {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }

    this.objects.set(key, value);
    return { key };
  }
}

type RunningWorkerServer = {
  url: string;
  close: () => Promise<void>;
};

let tempDir: string;
let running: RunningWorkerServer | undefined;

test.beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "loopmark-e2e-"));
  running = await startWorkerServer(resolve("dist/web"));
});

test.afterEach(async () => {
  await running?.close();
  running = undefined;
  await rm(tempDir, { recursive: true, force: true });
});

test("creates a cloud session, submits in the browser, and collects decrypted output", async ({ page }) => {
  if (!running) {
    throw new Error("Worker server is not running.");
  }

  const create = await runLoopmark(
    ["--base-url", running.url, "--receipt-dir", tempDir],
    JSON.stringify({
      title: "Remote input check",
      description: "A full cloud protocol smoke test.",
      fields: [
        { id: "scope", label: "What should the agent do next?", type: "text", required: true },
        {
          id: "confidence",
          label: "How confident are you?",
          type: "choice",
          mode: "single",
          required: true,
          options: ["Ready", "Needs another pass"]
        },
        { id: "api_key", label: "Optional API key", type: "text", secret: true }
      ]
    })
  );
  expect(create.code).toBe(0);
  const created = JSON.parse(create.stdout) as { status: string; fillUrl: string; receiptFile: string };
  expect(created.status).toBe("created");
  expect(created.fillUrl).toMatch(new RegExp(`^${escapeRegExp(running.url)}/s#lm1_`));
  expect(create.stderr).toContain(`Loopmark URL: ${created.fillUrl}`);

  const pending = await runLoopmark(["collect", created.receiptFile, "--secret-dir", tempDir]);
  expect(pending.code).toBe(0);
  expect(JSON.parse(pending.stdout)).toEqual({
    status: "pending",
    message: "Loopmark session has not been submitted yet."
  });

  await page.goto(created.fillUrl);
  await expect(page.getByRole("heading", { name: "Remote input check" })).toBeVisible();
  await page.getByLabel("What should the agent do next?*").fill("Ship the cloud-only Loopmark flow.");
  await page.getByRole("button", { name: "Ready" }).click();
  await page.getByLabel("Optional API key").fill("secret-from-cloud-e2e");
  await page.getByRole("button", { name: /Submit inputs/i }).click();
  await expect(page.getByText("Inputs submitted")).toBeVisible();

  const collect = await runLoopmark(["collect", created.receiptFile, "--secret-dir", tempDir]);
  expect(collect.code).toBe(0);
  const output = JSON.parse(collect.stdout) as {
    status: string;
    answers: {
      scope: { answer: string };
      confidence: { answer: { label: string } };
      api_key: { answer: { secretFile: string; description: string } };
    };
  };
  expect(output.status).toBe("submitted");
  expect(output.answers.scope.answer).toBe("Ship the cloud-only Loopmark flow.");
  expect(output.answers.confidence.answer).toEqual({ label: "Ready" });
  expect(JSON.stringify(output)).not.toContain("secret-from-cloud-e2e");
  expect(output.answers.api_key.answer.description).toContain("omitted");
  expect(await readFile(output.answers.api_key.answer.secretFile, "utf8")).toBe("secret-from-cloud-e2e");
});

async function startWorkerServer(webRoot: string): Promise<RunningWorkerServer> {
  const env: WorkerEnv = {
    LOOPMARK_SESSIONS: new MemoryR2Bucket(),
    ASSETS: createAssetsBinding(webRoot)
  };
  const server = createServer((request, response) => {
    void handleNodeRequest(request, response, env);
  });

  await new Promise<void>((resolvePromise) => {
    server.listen(0, "127.0.0.1", resolvePromise);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine Worker test server address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      })
  };
}

async function handleNodeRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  env: WorkerEnv
): Promise<void> {
  try {
    const request = await toFetchRequest(incoming);
    const response = await worker.fetch(request, env);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end(error instanceof Error ? error.message : "Unexpected test server error.");
  }
}

async function toFetchRequest(incoming: IncomingMessage): Promise<Request> {
  const host = incoming.headers.host ?? "127.0.0.1";
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return new Request(`http://${host}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers: incoming.headers as HeadersInit,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined
  });
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value);
  });

  if (!response.body) {
    outgoing.end();
    return;
  }

  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function createAssetsBinding(webRoot: string): WorkerEnv["ASSETS"] {
  return {
    fetch: async (request) => {
      const url = new URL(request.url);
      const file = safeAssetPath(webRoot, url.pathname);
      if (!file) {
        return new Response("Not found", { status: 404 });
      }

      try {
        const body = await readFile(file);
        return new Response(body, {
          headers: { "content-type": contentType(file) }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  };
}

function safeAssetPath(webRoot: string, pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);
  const relative = decoded === "/" || decoded === "/s" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(webRoot, relative);
  if (file !== webRoot && !file.startsWith(`${webRoot}${sep}`)) {
    return null;
  }
  return file;
}

function contentType(file: string): string {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".png":
      return "image/png";
    case ".ico":
      return "image/x-icon";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function runLoopmark(args: string[], input = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [resolve("dist/cli/index.js"), ...args], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr });
    });
    child.stdin.end(input);
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
