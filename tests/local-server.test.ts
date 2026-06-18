import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRemoteSession } from "../src/cli/remote";
import { createRemoteSessionPackage, decryptSessionEnvelope, extractSessionCodeFromHash } from "../src/shared/cloud-protocol";
import { parseInputJson } from "../src/shared/schema";
import { startLocalLoopmarkServer, type RunningLoopmarkServer } from "../src/server/local-server";

let tempDir: string;
let running: RunningLoopmarkServer | undefined;

afterEach(async () => {
  await running?.close();
  running = undefined;
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
});

it("serves local web assets and rejects missing or unsafe asset paths", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "loopmark-local-server-"));
  const webRoot = join(tempDir, "web");
  await mkdir(join(webRoot, "assets"), { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Local Loopmark</title>");
  await writeFile(join(webRoot, "assets", "app.js"), "console.log('loopmark');");
  await writeFile(join(webRoot, "assets", "app.css"), "body { color: black; }");
  await writeFile(join(webRoot, "data.json"), "{}");
  await writeFile(join(webRoot, "logo.svg"), "<svg></svg>");
  await writeFile(join(webRoot, "favicon.ico"), "");
  await writeFile(join(webRoot, "site.webmanifest"), "{}");
  await writeFile(join(webRoot, "asset.bin"), "bin");
  running = await startLocalLoopmarkServer(webRoot);

  await expectAsset("/s", "text/html; charset=utf-8", "Local Loopmark");
  await expectAsset("/assets/app.js", "text/javascript; charset=utf-8", "loopmark");
  await expectAsset("/assets/app.css", "text/css; charset=utf-8", "color");
  await expectAsset("/data.json", "application/json; charset=utf-8", "{}");
  await expectAsset("/logo.svg", "image/svg+xml", "<svg");
  await expectAsset("/favicon.ico", "image/x-icon", "");
  await expectAsset("/site.webmanifest", "application/manifest+json; charset=utf-8", "{}");
  await expectAsset("/asset.bin", "application/octet-stream", "bin");
  await expect((await fetch(`${running.url}/missing.txt`)).status).toBe(404);
  await expect((await fetch(`${running.url}/%2e%2e/secret.txt`)).status).toBe(404);
  await expect((await fetch(`${running.url}/%E0%A4%A`)).status).toBe(404);
});

it("backs remote create and encrypted session retrieval with in-memory local storage", async () => {
  tempDir = await createMinimalWebRoot();
  running = await startLocalLoopmarkServer(join(tempDir, "web"));
  const session = parseInputJson(
    JSON.stringify({
      title: "Local try",
      fields: [{ id: "next", label: "What next?", type: "text" }]
    })
  );

  const created = await createRemoteSession(session, { baseUrl: running.url, receiptDir: tempDir });
  expect(created.fillUrl).toMatch(new RegExp(`^${escapeRegExp(running.url)}/s#lm1_`));

  const response = await fetch(`${running.url}/api/sessions/${created.sessionId}`);
  expect(response.status).toBe(200);
  const sessionCode = extractSessionCodeFromHash(new URL(created.fillUrl).hash);
  if (!sessionCode) {
    throw new Error("Expected session code in fill URL.");
  }
  await expect(decryptSessionEnvelope(sessionCode, await response.json())).resolves.toMatchObject({
    session: { title: "Local try" }
  });
});

it("preserves worker API behavior through the local server adapter", async () => {
  tempDir = await createMinimalWebRoot();
  running = await startLocalLoopmarkServer(join(tempDir, "web"));
  const session = parseInputJson(
    JSON.stringify({
      title: "Duplicate check",
      fields: [{ id: "next", label: "What next?", type: "text" }]
    })
  );
  const sessionPackage = await createRemoteSessionPackage({ session, baseUrl: running.url });
  const createUrl = `${running.url}/api/sessions`;

  const firstCreate = await fetch(createUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionPackage.envelope)
  });
  expect(firstCreate.status).toBe(201);

  const duplicateCreate = await fetch(createUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionPackage.envelope)
  });
  expect(duplicateCreate.status).toBe(409);

  const invalidCreate = await fetch(createUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{"
  });
  expect(invalidCreate.status).toBe(400);
});

async function expectAsset(path: string, contentType: string, expectedText: string): Promise<void> {
  if (!running) {
    throw new Error("Local Loopmark server is not running.");
  }

  const response = await fetch(`${running.url}${path}`);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe(contentType);
  expect(await response.text()).toContain(expectedText);
}

async function createMinimalWebRoot(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "loopmark-local-server-"));
  const webRoot = join(directory, "web");
  await mkdir(webRoot, { recursive: true });
  await writeFile(join(webRoot, "index.html"), "<!doctype html><title>Local Loopmark</title>");
  return directory;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
