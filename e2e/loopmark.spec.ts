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
  await page.getByLabel("What should the agent do next?").fill("Ship the cloud-only Loopmark flow.");
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
