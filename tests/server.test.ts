import { join } from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeSession } from "../src/shared/schema";
import { startInterrogateServer, type RunningInterrogateServer } from "../src/server/http";
import { getBrowserCommand } from "../src/server/open-browser";

let tempDir: string;
let running: RunningInterrogateServer | undefined;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "interrogate-server-test-"));
  await writeFile(join(tempDir, "index.html"), "<div id=\"root\">InterroGate</div>");
  await mkdir(join(tempDir, "assets"));
  await writeFile(join(tempDir, "assets", "asset.js"), "console.log('asset');");
});

afterEach(async () => {
  if (running) {
    await running.close().catch(() => undefined);
    running = undefined;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("local HTTP server", () => {
  it("serves the session and resolves final output after submit", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text", required: true }]
    });

    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });
    const sessionResponse = await fetch(`http://127.0.0.1:${running.port}/api/session?token=${running.token}`);
    expect(sessionResponse.status).toBe(200);
    expect(await sessionResponse.json()).toMatchObject({ title: "Need input" });

    const forbidden = await fetch(`http://127.0.0.1:${running.port}/api/session?token=nope`);
    expect(forbidden.status).toBe(403);

    const submit = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "MVP" } } })
    });
    expect(submit.status).toBe(200);

    await expect(running.result).resolves.toEqual({
      status: "submitted",
      answers: {
        scope: {
          question: "Scope",
          answer: "MVP"
        }
      }
    });
  });

  it("rejects repeat submissions", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const url = `http://127.0.0.1:${running.port}/api/submit?token=${running.token}`;
    const body = JSON.stringify({ answers: { scope: { type: "text", value: "First" } } });
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(200);
    expect((await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body })).status).toBe(409);
  });

  it("serves API requests when optional roots use their defaults", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session);

    const response = await fetch(`http://127.0.0.1:${running.port}/api/session?token=${running.token}`);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ title: "Need input" });
  });

  it("allows only one successful submit when valid requests arrive concurrently", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text", required: true }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const url = `http://127.0.0.1:${running.port}/api/submit?token=${running.token}`;
    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "Concurrent submit" } } })
    };
    const responses = await Promise.all([fetch(url, request), fetch(url, request)]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([200, 409]);
    await expect(running.result).resolves.toMatchObject({
      answers: { scope: { answer: "Concurrent submit" } }
    });
  });

  it("rejects unauthorized direct submissions", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=wrong-token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "Nope" } } })
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "Invalid session token." });
    await expect(Promise.race([running.result.then(() => "settled"), delay(25).then(() => "pending")])).resolves.toBe(
      "pending"
    );
  });

  it("rejects direct submits that omit required answers without settling the session", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text", required: true }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: {} })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "invalid_submit",
      errors: [
        {
          fieldId: "scope",
          code: "required_answer_missing"
        }
      ]
    });
    await expect(Promise.race([running.result.then(() => "settled"), delay(25).then(() => "pending")])).resolves.toBe(
      "pending"
    );
  });

  it("rejects direct submits with too many single-choice answers", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "decision",
          label: "Decision",
          type: "choice",
          mode: "single",
          options: ["A", "B"]
        }
      ]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: {
          decision: { type: "choice", items: [{ label: "A" }, { label: "B" }] }
        }
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "invalid_submit",
      errors: [{ fieldId: "decision", code: "too_many_single_choice_items" }]
    });
    await expect(Promise.race([running.result.then(() => "settled"), delay(25).then(() => "pending")])).resolves.toBe(
      "pending"
    );
  });

  it("rejects direct custom choice submits when custom answers are disabled", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [
        {
          id: "decision",
          label: "Decision",
          type: "choice",
          mode: "multiple",
          allowCustom: false,
          options: ["A", "B"]
        }
      ]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        answers: {
          decision: { type: "choice", items: [{ label: "C" }] }
        }
      })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      status: "invalid_submit",
      errors: [{ fieldId: "decision", code: "unknown_choice_item" }]
    });
    await expect(Promise.race([running.result.then(() => "settled"), delay(25).then(() => "pending")])).resolves.toBe(
      "pending"
    );
  });

  it("serves static files and returns JSON errors for unknown routes", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    expect((await fetch(running.url)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${running.port}/assets/asset.js`)).headers.get("content-type")).toContain(
      "text/javascript"
    );
    await writeFile(join(tempDir, "assets", "file.unknown"), "raw");
    expect((await fetch(`http://127.0.0.1:${running.port}/assets/file.unknown`)).headers.get("content-type")).toBe(
      "application/octet-stream"
    );
    expect((await fetch(`http://127.0.0.1:${running.port}/missing`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${running.port}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`http://127.0.0.1:${running.port}/assets/../index.html`)).status).toBe(404);
  });

  it("rejects invalid submit JSON without closing the session", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{bad"
    });

    expect(response.status).toBe(400);

    const valid = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "Recovered" } } })
    });
    expect(valid.status).toBe(200);
    await expect(running.result).resolves.toMatchObject({
      answers: { scope: { answer: "Recovered" } }
    });
  });

  it("rejects valid JSON submit bodies that are not submit objects without hanging", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });
    const url = `http://127.0.0.1:${running.port}/api/submit?token=${running.token}`;

    for (const body of ["null", "false", "0", "\"\""]) {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(250)
      });

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        status: "invalid_submit",
        errors: [{ code: "invalid_submit_payload" }]
      });
    }

    await expect(Promise.race([running.result.then(() => "settled"), delay(25).then(() => "pending")])).resolves.toBe(
      "pending"
    );

    const valid = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "Recovered" } } })
    });

    expect(valid.status).toBe(200);
    await expect(running.result).resolves.toMatchObject({
      answers: { scope: { answer: "Recovered" } }
    });
  });

  it("rejects oversized submit bodies without closing the session", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });
    const url = `http://127.0.0.1:${running.port}/api/submit?token=${running.token}`;

    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "x".repeat(1024 * 1024 + 1) } } })
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Request body is too large." });

    const valid = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { scope: { type: "text", value: "Recovered" } } })
    });
    expect(valid.status).toBe(200);
  });

  it("returns a server error and rejects the result when secret output cannot be written", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "token", label: "Token", type: "text", secret: true }]
    });
    const fileSecretRoot = join(tempDir, "not-a-directory");
    await writeFile(fileSecretRoot, "blocks mkdir");
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: fileSecretRoot });
    const resultPromise = running.result.catch((error: unknown) => error);

    const response = await fetch(`http://127.0.0.1:${running.port}/api/submit?token=${running.token}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { token: { type: "secret", value: "secret" } } })
    });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("EEXIST") });
    await expect(resultPromise).resolves.toBeInstanceOf(Error);
  });

  it("rejects closing an already closed server", async () => {
    const session = normalizeSession({
      title: "Need input",
      fields: [{ id: "scope", label: "Scope", type: "text" }]
    });
    running = await startInterrogateServer(session, { webRoot: tempDir, secretRoot: tempDir });
    const close = running.close;

    await close();
    running = undefined;

    await expect(close()).rejects.toThrow();
  });

  it("chooses browser open commands per platform", () => {
    expect(getBrowserCommand("http://local", "darwin")).toEqual({ command: "open", args: ["http://local"] });
    expect(getBrowserCommand("http://local", "win32")).toEqual({
      command: "cmd",
      args: ["/c", "start", "", "http://local"]
    });
    expect(getBrowserCommand("http://local", "linux")).toEqual({ command: "xdg-open", args: ["http://local"] });
  });
});
