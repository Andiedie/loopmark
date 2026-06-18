import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { test, expect } from "@playwright/test";
import { startLocalLoopmarkServer, type RunningLoopmarkServer } from "../src/server/local-server";

let tempDir: string;
let running: RunningLoopmarkServer | undefined;

test.beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "loopmark-e2e-"));
  running = await startLocalLoopmarkServer(resolve("dist/web"));
});

test.afterEach(async () => {
  await running?.close();
  running = undefined;
  await rm(tempDir, { recursive: true, force: true });
});

test("creates a cloud session, copies traceable Markdown, and downloads omitted secrets", async ({ page }) => {
  if (!running) {
    throw new Error("Worker server is not running.");
  }

  const create = await runLoopmark(
    ["--base-url", running.url, "--receipt-dir", tempDir],
    JSON.stringify({
      title: "Remote input check",
      description: "A full cloud protocol smoke test.",
      fields: [
        { id: "scope", label: "What should the agent do next?", type: "text" },
        {
          id: "confidence",
          label: "How confident are you?",
          type: "choice",
          mode: "single",
          options: ["Ready", "Needs another pass"]
        },
        { id: "api_key", label: "Optional API key", type: "text", secret: true }
      ]
    })
  );
  expect(create.code).toBe(0);
  const created = JSON.parse(create.stdout) as { status: string; fillUrl: string; receiptFile: string; sessionId: string };
  expect(created.status).toBe("created");
  expect(created.fillUrl).toMatch(new RegExp(`^${escapeRegExp(running.url)}/s#lm1_`));
  expect(create.stderr).toContain(`Loopmark URL: ${created.fillUrl}`);

  await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: new URL(created.fillUrl).origin
  });
  await page.goto(created.fillUrl);
  await expect(page.getByRole("heading", { name: "Remote input check" })).toBeVisible();
  await page.getByLabel("What should the agent do next?").fill("Ship the Markdown Loopmark flow.");
  await page.getByRole("button", { name: "Ready" }).click();
  await page.getByLabel("Optional API key", { exact: true }).fill("secret-from-cloud-e2e");
  await page.getByLabel("Note for Optional API key").fill("Use only in the smoke test.");
  await page.getByRole("button", { name: /Copy answers/i }).click();
  await expect(page.getByText("Answers copied")).toBeVisible();

  const markdown = await page.evaluate(() => navigator.clipboard.readText());
  expect(markdown).toContain("> Ship the Markdown Loopmark flow.");
  expect(markdown).toContain("> Ready");
  expect(markdown).toContain("> Use only in the smoke test.");
  expect(markdown).toContain(`npx --yes @andie/loopmark secrets ${created.sessionId}`);
  expect(markdown).not.toContain("```loopmark-answer");
  expect(markdown).not.toContain("secret-from-cloud-e2e");

  const secrets = await runLoopmark(["secrets", created.sessionId, "--receipt", created.receiptFile, "--secret-dir", tempDir]);
  expect(secrets.code).toBe(0);
  const output = JSON.parse(secrets.stdout) as {
    status: string;
    sessionId: string;
    secretFile: string;
    format: string;
  };
  expect(output.status).toBe("secrets_downloaded");
  expect(output.sessionId).toBe(created.sessionId);
  expect(output.format).toBe("env");
  expect(JSON.stringify(output)).not.toContain("secret-from-cloud-e2e");
  expect(await readFile(output.secretFile, "utf8")).toBe("api_key=secret-from-cloud-e2e\n");
});

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
