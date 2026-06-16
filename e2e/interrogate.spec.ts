import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test, expect, type Page } from "@playwright/test";
import { normalizeSession } from "../src/shared/schema";
import { startInterrogateServer, type RunningInterrogateServer } from "../src/server/http";

let running: RunningInterrogateServer | undefined;
let secretRoot: string;

test.beforeEach(async () => {
  secretRoot = await mkdtemp(join(tmpdir(), "interrogate-e2e-"));
});

test.afterEach(async () => {
  if (running) {
    await running.close().catch(() => undefined);
    running = undefined;
  }
  await rm(secretRoot, { recursive: true, force: true });
});

async function openSession(page: Page, input: unknown) {
  const session = normalizeSession(input);
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });
  await page.goto(running.url);
  return { resultPromise: running.result };
}

test("submits a simple ungrouped session with text, custom single choice, and empty optional secret", async ({
  page
}) => {
  const session = normalizeSession({
    title: "Quick agent check-in",
    description: "A tiny ungrouped session for trying the full CLI loop.",
    fields: [
      {
        id: "next_step",
        type: "text",
        label: "What should the agent do next?",
        required: true
      },
      {
        id: "confidence",
        type: "choice",
        mode: "single",
        label: "How confident are you in this direction?",
        required: true,
        options: ["Mostly confident", "Need another pass"]
      },
      {
        id: "private_note",
        type: "text",
        secret: true,
        label: "Optional private note"
      }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  const resultPromise = running.result;
  await page.goto(running.url);

  await expect(page.getByText("Outline")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Jump to first issue" })).toHaveCount(0);
  await page.getByLabel("What should the agent do next?*").fill("Polish the UI before adding protocol features.");
  const confidenceField = page.locator("#field-confidence");
  await confidenceField.getByRole("button", { name: "Add custom answer" }).click();
  await confidenceField.getByLabel("Add custom answer label").fill("Ship after visual QA");
  await confidenceField.getByLabel("Add custom answer description").fill("The implementation is ready after browser screenshots pass.");
  await confidenceField.getByRole("button", { name: /^Add$/ }).click();
  await page.getByRole("button", { name: /Submit inputs/i }).click();

  await expect(page.getByText("Inputs submitted")).toBeVisible();
  const output = await resultPromise;
  expect(output.answers).toEqual({
    next_step: {
      question: "What should the agent do next?",
      answer: "Polish the UI before adding protocol features."
    },
    confidence: {
      question: "How confident are you in this direction?",
      answer: {
        label: "Ship after visual QA",
        description: "The implementation is ready after browser screenshots pass."
      }
    },
    private_note: {
      question: "Optional private note",
      answer: null
    }
  });
});

test("rejects invalid tokens and duplicate submissions", async ({ request }) => {
  const session = normalizeSession({
    title: "Token lifecycle check",
    fields: [{ id: "summary", type: "text", label: "Summary", required: true }]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  const baseUrl = new URL(running.url).origin;
  const invalidSession = await request.get(`${baseUrl}/api/session?token=not-the-token`);
  expect(invalidSession.status()).toBe(403);
  expect(await invalidSession.text()).toContain("Invalid session token");

  const firstSubmit = await request.post(`${baseUrl}/api/submit?token=${running.token}`, {
    data: {
      answers: {
        summary: { type: "text", value: "First and only submit." }
      }
    }
  });
  expect(firstSubmit.status()).toBe(200);
  expect(await firstSubmit.text()).toContain('"ok":true');

  const output = await running.result;
  expect(output.answers.summary).toEqual({
    question: "Summary",
    answer: "First and only submit."
  });

  const duplicateSubmit = await request.post(`${baseUrl}/api/submit?token=${running.token}`, {
    data: {
      answers: {
        summary: { type: "text", value: "Second submit should fail." }
      }
    }
  });
  expect(duplicateSubmit.status()).toBe(409);
  expect(await duplicateSubmit.text()).toContain("already been submitted");
});

test("submits a complex grouped session with custom choices, ranking edits, and secret file reference", async ({
  page
}) => {
  const session = normalizeSession({
    title: "InterroGate implementation questions",
    description: "A local input gate for AI Agents.",
    groups: [
      {
        id: "product",
        title: "Product direction",
        fields: [
          {
            id: "positioning",
            type: "text",
            label: "How should the agent describe this product?",
            multiline: true,
            required: true,
            default: "A local Human Input gate for AI Agents."
          },
          {
            id: "style",
            type: "choice",
            mode: "single",
            label: "Which visual direction should guide implementation?",
            required: true,
            options: ["Paper Trail", "Focus Ledger"]
          }
        ]
      },
      {
        id: "implementation",
        title: "Implementation details",
        fields: [
          {
            id: "scope",
            type: "choice",
            mode: "multiple",
            label: "Which capabilities belong in v1?",
            required: true,
            options: ["stdin JSON", "Local Web UI", "stdout JSON"]
          },
          {
            id: "priority",
            type: "choice",
            mode: "ranking",
            label: "Rank the implementation priorities.",
            required: true,
            options: ["Input validation", "CLI lifecycle", "Paper Trail UI"]
          },
          {
            id: "api_key",
            type: "text",
            secret: true,
            label: "Optional API key for local testing"
          }
        ]
      }
    ]
  });

  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  const resultPromise = running.result;
  const consoleMessages: string[] = [];
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      consoleMessages.push(message.text());
    }
  });

  await page.goto(running.url);
  await expect(page.getByRole("heading", { name: "InterroGate implementation questions" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Paper Trail", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Paper Trail", exact: true }).click();
  await page.getByRole("button", { name: "stdin JSON" }).click();
  await page.getByRole("button", { name: "Local Web UI" }).click();
  const scopeField = page.locator("#field-scope");
  await expect(scopeField.getByLabel("Add custom answer label")).toHaveCount(0);
  await scopeField.getByRole("button", { name: "Add custom answer" }).click();
  await expect(scopeField.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await scopeField.getByLabel("Add custom answer label").fill("Agent-readable output");
  await scopeField.getByRole("button", { name: /^Add$/ }).click();
  await expect(scopeField.getByRole("button", { name: /Agent-readable output/ })).toBeVisible();
  await expect(scopeField.getByText("Selected details")).toHaveCount(0);
  const priorityField = page.locator("#field-priority");
  await expect(priorityField.getByLabel("Ranking label 1")).toHaveCount(0);
  await expect(priorityField.getByRole("button", { name: /Move Input validation down/i })).toBeVisible();
  await priorityField.getByRole("button", { name: /Move Input validation down/i }).click();
  await priorityField.getByRole("button", { name: "Edit details" }).click();
  await expect(priorityField.getByRole("button", { name: "Add ranked item" })).toHaveCount(0);
  await priorityField.getByLabel("Ranking label 2").fill("Input validation and readable errors");
  await priorityField.getByLabel("Ranking description 2").fill("Tell the agent where the JSON failed and how to fix it.");
  await priorityField.getByRole("button", { name: "Done editing" }).click();
  await priorityField.getByRole("button", { name: "Add ranked item" }).click();
  await expect(priorityField.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await priorityField.getByLabel("Add ranked item label").fill("High-coverage tests");
  await priorityField.getByLabel("Add ranked item description").fill("Unit, integration, and e2e coverage before handoff.");
  await priorityField.getByRole("button", { name: /^Add$/ }).click();
  await page.getByLabel("Optional API key for local testing").fill("secret-from-e2e");
  await page.getByRole("button", { name: /Submit inputs/i }).click();

  await expect(page.getByText("Inputs submitted")).toBeVisible();
  expect(consoleMessages).toEqual([]);

  const output = await resultPromise;
  expect(output.answers.style).toEqual({
    question: "Which visual direction should guide implementation?",
    answer: { label: "Paper Trail" }
  });
  expect(output.answers.scope).toEqual({
    question: "Which capabilities belong in v1?",
    answer: [{ label: "stdin JSON" }, { label: "Local Web UI" }, { label: "Agent-readable output" }]
  });
  expect(output.answers.priority.answer).toEqual([
    { label: "CLI lifecycle" },
    { label: "Input validation and readable errors", description: "Tell the agent where the JSON failed and how to fix it." },
    { label: "Paper Trail UI" },
    { label: "High-coverage tests", description: "Unit, integration, and e2e coverage before handoff." }
  ]);

  const secretAnswer = output.answers.api_key.answer as { secretFile: string; description: string };
  expect(JSON.stringify(output)).not.toContain("secret-from-e2e");
  expect(await readFile(secretAnswer.secretFile, "utf8")).toBe("secret-from-e2e");
});

test("renders without layout overflow on a mobile viewport", async ({ page }) => {
  const session = normalizeSession({
    title: "Mobile check",
    fields: [
      { id: "summary", type: "text", label: "Summarize the desired outcome", required: true },
      { id: "choice", type: "choice", label: "Pick a direction", options: ["Simple", "Detailed"] }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(running.url);
  await expect(page.getByText("Mobile check").first()).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});

test("renders compact sortable ranking rows on a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openSession(page, {
    title: "Mobile ranking",
    fields: [
      {
        id: "priority",
        type: "choice",
        mode: "ranking",
        label: "Rank priorities",
        required: true,
        options: [
          { label: "Visual fidelity", description: "Match the accepted Paper Trail concept." },
          { label: "Protocol clarity", description: "Keep JSON compact and readable." },
          { label: "Meaningful test coverage", description: "Protect schema, output, server lifecycle, and UI flows." }
        ]
      }
    ]
  });

  const field = page.locator("#field-priority");
  await field.scrollIntoViewIfNeeded();
  const metrics = await field.getByTestId("ranking-item").evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.getBoundingClientRect();
      const rankElement = row.querySelector('[data-testid="ranking-rank"]');
      const rank = rankElement?.getBoundingClientRect();
      const handleElement = row.querySelector('[data-testid="ranking-drag"]');
      const handle = handleElement?.getBoundingClientRect();
      const actions = row.querySelector('[data-testid="ranking-actions"]')?.getBoundingClientRect();
      return {
        rowHeight: Math.round(box.height),
        rankWidth: rank ? Math.round(rank.width) : 0,
        rankBorderWidth: rankElement ? getComputedStyle(rankElement).borderTopWidth : "",
        dragTouchAction: handleElement ? getComputedStyle(handleElement).touchAction : "",
        rankTop: rank ? Math.round(rank.top - box.top) : 999,
        handleTop: handle ? Math.round(handle.top - box.top) : 999,
        actionsTop: actions ? Math.round(actions.top - box.top) : 999
      };
    })
  );

  expect(metrics).toHaveLength(3);
  for (const row of metrics) {
    expect(row.rowHeight).toBeLessThan(130);
    expect(row.rankWidth).toBeLessThanOrEqual(28);
    expect(row.rankBorderWidth).toBe("0px");
    expect(row.dragTouchAction).toBe("none");
    expect(row.handleTop).toBeLessThan(24);
    expect(row.rankTop).toBeLessThan(24);
    expect(row.actionsTop).toBeLessThan(24);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);

  await field.getByRole("button", { name: "Move Protocol clarity up" }).click();
  const order = await field.getByTestId("ranking-item").evaluateAll((rows) =>
    rows.map((row) => row.textContent ?? "")
  );
  expect(order[0]).toContain("Protocol clarity");
});

test("touch-drag ranking handle reorders on mobile without scrolling the page", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();

  try {
    await openSession(page, {
      title: "Touch ranking",
      fields: [
        {
          id: "priority",
          type: "choice",
          mode: "ranking",
          label: "Rank priorities",
          options: ["Alpha", "Beta", "Gamma"]
        }
      ]
    });

    const field = page.locator("#field-priority");
    await field.scrollIntoViewIfNeeded();
    const handle = page.getByLabel("Drag Beta");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveCSS("touch-action", "none");

    const box = await handle.boundingBox();
    expect(box).not.toBeNull();
    const beforeScroll = await page.evaluate(() => window.scrollY);
    const client = await context.newCDPSession(page);
    const x = Math.round(box!.x + box!.width / 2);
    const y = Math.round(box!.y + box!.height / 2);

    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x, y }]
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 90 }]
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x, y: y - 130 }]
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: []
    });

    await page.waitForTimeout(250);
    const afterScroll = await page.evaluate(() => window.scrollY);
    expect(Math.abs(afterScroll - beforeScroll)).toBeLessThan(4);
    const order = await field.getByTestId("ranking-item").evaluateAll((rows) =>
      rows.map((row) => row.textContent ?? "")
    );
    expect(order[0]).toContain("Beta");
  } finally {
    await context.close();
  }
});

test("keeps ranking detail inputs focused while typing", async ({ page }) => {
  await openSession(page, {
    title: "Ranking focus",
    fields: [
      {
        id: "priority",
        type: "choice",
        mode: "ranking",
        label: "Rank priorities",
        options: ["Alpha", "Beta"]
      }
    ]
  });

  const field = page.locator("#field-priority");
  await field.getByRole("button", { name: "Edit details" }).click();
  await field.getByLabel("Ranking label 1").focus();
  await page.keyboard.type("XY");

  await expect(field.getByLabel("Ranking label 1")).toBeFocused();
  await expect(field.getByLabel("Ranking label 1")).toHaveValue("AlphaXY");
});

test("preserves spaces while typing ranking descriptions in the browser", async ({ page }) => {
  await openSession(page, {
    title: "Ranking description typing",
    fields: [
      {
        id: "priority",
        type: "choice",
        mode: "ranking",
        label: "Rank priorities",
        allowCustom: false,
        options: [
          { label: "Alpha", description: "Original first detail." },
          { label: "Beta", description: "Original second detail." }
        ]
      }
    ]
  });

  const field = page.locator("#field-priority");
  await field.getByRole("button", { name: "Edit details" }).click();
  await expect(field.getByLabel("Ranking label 1")).toHaveCount(0);

  const description = field.getByLabel("Ranking description 1");
  await description.fill("");
  await description.click();
  await page.keyboard.type("Updated ranking detail.");
  await expect(description).toHaveValue("Updated ranking detail.");

  await field.getByRole("button", { name: "Done editing" }).click();
  await expect(field.getByText("Updated ranking detail.")).toBeVisible();
});

test("keeps ranking add and edit panels mutually exclusive", async ({ page }) => {
  await openSession(page, {
    title: "Ranking panels",
    fields: [
      {
        id: "priority",
        type: "choice",
        mode: "ranking",
        label: "Rank priorities",
        options: ["Visual fidelity", "Protocol clarity"]
      }
    ]
  });

  const field = page.locator("#field-priority");
  await field.getByRole("button", { name: "Add ranked item" }).click();
  await expect(field.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await field.getByRole("button", { name: "Cancel" }).click();

  await field.getByRole("button", { name: "Edit details" }).click();
  await expect(field.getByRole("button", { name: "Add ranked item" })).toHaveCount(0);
  await field.getByRole("button", { name: "Done editing" }).click();

  await field.getByRole("button", { name: "Add ranked item" }).click();
  await field.getByLabel("Add ranked item label").fill("High-confidence handoff");
  await field.getByRole("button", { name: /^Add$/ }).click();
  await expect(field.getByText("High-confidence handoff")).toBeVisible();
});

test("resets choice answers and removes custom draft options after confirmation", async ({ page }) => {
  const { resultPromise } = await openSession(page, {
    title: "Choice reset",
    fields: [
      {
        id: "style",
        type: "choice",
        mode: "single",
        label: "Pick a style",
        required: true,
        default: "Paper Trail",
        options: ["Paper Trail", "Compact Tool"]
      }
    ]
  });

  const field = page.locator("#field-style");
  await field.getByRole("button", { name: "Add custom answer" }).click();
  await field.getByLabel("Add custom answer label").fill("Editorial Review");
  await field.getByRole("button", { name: /^Add$/ }).click();
  await expect(field.getByRole("button", { name: /Editorial Review/ })).toBeVisible();

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await field.getByRole("button", { name: "Reset Pick a style" }).click();
  await expect(field.getByRole("button", { name: /Editorial Review/ })).toHaveCount(0);
  await page.getByRole("button", { name: /Submit inputs/i }).click();

  const output = await resultPromise;
  expect(output.answers.style).toEqual({
    question: "Pick a style",
    answer: { label: "Paper Trail" }
  });
});

test("submits optional single choice as null after toggling the selection off", async ({ page }) => {
  const { resultPromise } = await openSession(page, {
    title: "Optional single choice",
    fields: [{ id: "direction", type: "choice", label: "Pick a direction", options: ["Yes", "No"] }]
  });

  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: "Yes" }).click();
  await page.getByRole("button", { name: /Submit inputs/i }).click();

  const output = await resultPromise;
  expect(output.answers.direction).toEqual({
    question: "Pick a direction",
    answer: null
  });
});

test("keeps secret helper text hidden while returning only a secret file reference", async ({ page }) => {
  const { resultPromise } = await openSession(page, {
    title: "Secret check",
    fields: [{ id: "token", type: "text", secret: true, label: "Local token" }]
  });

  const field = page.locator("#field-token");
  await expect(field.getByText("Secret answer is written to a temporary file and omitted from stdout.")).toBeHidden();
  await page.getByLabel("Local token").fill("secret-from-focused-e2e");
  await page.getByRole("button", { name: /Submit inputs/i }).click();

  const output = await resultPromise;
  expect(JSON.stringify(output)).not.toContain("secret-from-focused-e2e");
  const answer = output.answers.token.answer as { secretFile: string; description: string };
  expect(answer.description).toContain("omitted");
  expect(await readFile(answer.secretFile, "utf8")).toBe("secret-from-focused-e2e");
});

test("shows choice details without editing and hides unavailable remove actions", async ({ page }) => {
  const session = normalizeSession({
    title: "Choice detail behavior",
    fields: [
      {
        id: "single",
        type: "choice",
        mode: "single",
        label: "Pick the visual direction",
        required: true,
        default: {
          label: "Paper Trail",
          description: "Elegant document-like layout."
        },
        options: [
          {
            label: "Paper Trail",
            description: "Elegant document-like layout."
          },
          "Plain Form"
        ]
      },
      {
        id: "multi",
        type: "choice",
        mode: "multiple",
        label: "Pick required capabilities",
        required: true,
        default: [
          {
            label: "Readable validation errors",
            description: "Tell the agent exactly what failed."
          },
          {
            label: "Secret file output",
            description: "Keep sensitive values out of stdout."
          }
        ],
        options: ["Readable validation errors", "Secret file output", "Ranking edits"]
      }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.goto(running.url);
  const singleField = page.locator("#field-single");
  const multiField = page.locator("#field-multi");

  await expect(singleField.getByText("Elegant document-like layout.")).toBeVisible();
  await expect(multiField.getByText("Tell the agent exactly what failed.")).toBeVisible();
  await expect(page.getByText("Selected details")).toHaveCount(0);
  const singleOptionColumns = await singleField.getByTestId("choice-options-single").evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.trim().split(/\s+/).length
  );
  expect(singleOptionColumns).toBe(1);

  await singleField.getByRole("button", { name: "Add custom answer" }).click();
  await expect(singleField.getByRole("button", { name: "Edit details" })).toHaveCount(0);
  await singleField.getByRole("button", { name: "Cancel" }).click();
  await singleField.getByRole("button", { name: "Edit details" }).click();
  await expect(singleField.getByText("Selected details")).toBeVisible();
  await expect(singleField.getByRole("button", { name: "Remove Paper Trail" })).toHaveCount(0);
  await expect(singleField.getByRole("button", { name: "Add custom answer" })).toHaveCount(0);

  await multiField.getByRole("button", { name: "Edit details" }).click();
  await expect(multiField.getByRole("button", { name: "Remove Readable validation errors" })).toBeVisible();
  await multiField.getByRole("button", { name: "Remove Readable validation errors" }).click();
  await expect(multiField.getByRole("button", { name: "Remove Readable validation errors" })).toHaveCount(0);
});

test("keeps custom choices and edited details available after switching selections", async ({ page }) => {
  const session = normalizeSession({
    title: "Choice draft persistence",
    fields: [
      {
        id: "style",
        type: "choice",
        mode: "single",
        label: "Pick a style",
        required: true,
        options: [
          { label: "Paper Trail", description: "Elegant document-like layout." },
          { label: "Compact Tool", description: "Dense utility interface." }
        ]
      }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.goto(running.url);
  const field = page.locator("#field-style");
  await field.getByRole("button", { name: "Add custom answer" }).click();
  await field.getByLabel("Add custom answer label").fill("Editorial Review");
  await field.getByLabel("Add custom answer description").fill("Custom answer should stay available.");
  await field.getByRole("button", { name: /^Add$/ }).click();

  await field.getByRole("button", { name: /Compact Tool/ }).click();
  await expect(field.getByRole("button", { name: /Editorial Review/ })).toBeVisible();
  await expect(field.getByText("Custom answer should stay available.")).toBeVisible();

  await field.getByRole("button", { name: /Paper Trail/ }).click();
  await field.getByRole("button", { name: "Edit details" }).click();
  await field.getByLabel("Answer description 1").fill("Edited description should survive switching.");
  await field.getByRole("button", { name: "Done editing" }).click();
  await field.getByRole("button", { name: /Compact Tool/ }).click();

  await expect(field.getByText("Edited description should survive switching.")).toBeVisible();
});

test("resets changed answers only after confirmation", async ({ page }) => {
  const session = normalizeSession({
    title: "Reset behavior",
    fields: [{ id: "summary", type: "text", label: "Summary", required: true, default: "Initial summary" }]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.goto(running.url);
  const summary = page.getByLabel("Summary*");
  await summary.fill("Human edit");
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("Reset");
    await dialog.dismiss();
  });
  await page.getByRole("button", { name: "Reset Summary" }).click();
  await expect(summary).toHaveValue("Human edit");

  page.once("dialog", async (dialog) => {
    await dialog.accept();
  });
  await page.getByRole("button", { name: "Reset Summary" }).click();
  await expect(summary).toHaveValue("Initial summary");
});

test("hides the agent default hint after a text default is edited", async ({ page }) => {
  const session = normalizeSession({
    title: "Default hint behavior",
    fields: [
      {
        id: "summary",
        type: "text",
        label: "Review this default",
        required: true,
        default: "Agent drafted answer."
      }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.goto(running.url);
  await expect(page.getByTestId("agent-default-hint")).toHaveCount(1);
  const headerHeightBeforeEdit = await page
    .getByTestId("field-summary-header")
    .evaluate((element) => element.getBoundingClientRect().height);

  await page.getByLabel("Review this default*").fill("Human edited answer.");

  await expect(page.getByTestId("agent-default-hint")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset Review this default" })).toBeVisible();
  const headerHeightAfterEdit = await page
    .getByTestId("field-summary-header")
    .evaluate((element) => element.getBoundingClientRect().height);
  expect(Math.abs(headerHeightAfterEdit - headerHeightBeforeEdit)).toBeLessThan(0.5);
});

test("expands a collapsed group when validation fails inside it", async ({ page }) => {
  const session = normalizeSession({
    title: "Collapsed validation check",
    groups: [
      {
        id: "context",
        title: "Context",
        fields: [
          {
            id: "required_context",
            type: "text",
            label: "Required context",
            required: true,
            default: "This default will be cleared before submit."
          }
        ]
      },
      {
        id: "preferences",
        title: "Preferences",
        fields: [{ id: "style", type: "choice", label: "Pick a style", options: ["Paper Trail"] }]
      }
    ]
  });
  running = await startInterrogateServer(session, {
    webRoot: resolve("dist/web"),
    secretRoot
  });

  await page.goto(running.url);
  await expect(page.getByRole("button", { name: "Jump to first issue" })).toHaveCount(0);
  await page.getByLabel("Required context*").fill("");
  await page.locator("#group-context > button").click();
  await expect(page.getByLabel("Required context*")).toHaveCount(0);

  await page.getByRole("button", { name: /Submit inputs/i }).click();

  await expect(page.getByRole("button", { name: "Jump to first issue" })).toHaveCount(0);
  await expect(page.getByLabel("Required context*")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("This required question needs an answer");
});
