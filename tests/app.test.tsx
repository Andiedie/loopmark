import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { normalizeSession, type NormalizedSession } from "../src/shared/schema";
import {
  assertSecretBundleEnvelope,
  createRemoteSessionPackage,
  decryptSecretBundleEnvelope,
  type RemoteSessionPackage
} from "../src/shared/cloud-protocol";

const session: NormalizedSession = normalizeSession({
  title: "Need input",
  fields: [
    { id: "notes", type: "text", label: "Notes" },
    {
      id: "style",
      type: "choice",
      label: "Style",
      mode: "single",
      options: ["Simple", "Complete"]
    }
  ]
});

type CloudSessionMock = RemoteSessionPackage & {
  fetchMock: ReturnType<typeof vi.fn>;
  secretUploads: unknown[];
};

type CloudSessionOptions = {
  sessionResponse?: Response;
  secretUploadResponse?: Response;
};

async function installCloudSession(
  loadedSession: NormalizedSession,
  options: CloudSessionOptions = {}
): Promise<CloudSessionMock> {
  const remote = await createRemoteSessionPackage({
    session: loadedSession,
    baseUrl: "https://loopmark.test"
  });
  const secretUploads: unknown[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "https://loopmark.test").pathname;

    if (path === `/api/sessions/${remote.sessionId}`) {
      return options.sessionResponse ?? new Response(JSON.stringify(remote.envelope), { status: 200 });
    }

    if (path === `/api/sessions/${remote.sessionId}/secrets`) {
      const body = input instanceof Request ? await input.json() : JSON.parse(String(init?.body));
      secretUploads.push(body);
      return options.secretUploadResponse ?? new Response(JSON.stringify({ ok: true }), { status: 201 });
    }

    return new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const fillUrl = new URL(remote.fillUrl);
  window.history.pushState({}, "", `${fillUrl.pathname}${fillUrl.hash}`);
  return { ...remote, fetchMock, secretUploads };
}

async function renderCloudApp(loadedSession: NormalizedSession, options?: CloudSessionOptions): Promise<CloudSessionMock> {
  const remote = await installCloudSession(loadedSession, options);
  render(<App />);
  return remote;
}

function installClipboard(writeText?: (value: string) => Promise<void>) {
  let copiedText = "";
  const clipboard = {
    writeText: vi.fn(
      writeText ??
        (async (value: string) => {
          copiedText = value;
        })
    )
  };
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: clipboard
  });

  return {
    clipboard,
    copiedText: () => copiedText
  };
}

async function decryptFirstSecretUpload(remote: CloudSessionMock) {
  const upload = remote.secretUploads[0];
  if (!upload || typeof upload !== "object" || !("envelope" in upload)) {
    throw new Error("Expected an uploaded secret bundle.");
  }
  const envelope = upload.envelope;
  assertSecretBundleEnvelope(envelope);

  return decryptSecretBundleEnvelope({
    receipt: remote.receipt,
    envelope
  });
}

describe("Loopmark UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: undefined
    });
    document.title = "Loopmark";
    window.history.pushState({}, "", "/");
  });

  it("uses the session title in the browser title and shows the logo mark in the header", async () => {
    await renderCloudApp(session);

    await screen.findByRole("heading", { name: "Need input" });
    await waitFor(() => expect(document.title).toBe("Need input - Loopmark"));

    expect(screen.getByRole("img", { name: "Loopmark" })).toHaveAttribute("src", "/icon-192.png");
    expect(screen.queryByText(/^Loopmark$/)).not.toBeInTheDocument();
  });

  it("loads a session, ignores legacy required flags, captures choice notes, and copies Other", async () => {
    const remote = await renderCloudApp(session);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    expect((await screen.findAllByText("Need input")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/required question needs an answer/i)).not.toBeInTheDocument();

    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    await user.click(styleField.getByRole("button", { name: "Other" }));
    await user.type(styleField.getByLabelText("Other answer for Style"), "Custom direction");
    await user.click(styleField.getByRole("button", { name: "Add note" }));
    await user.type(styleField.getByLabelText("Note for Style"), "Need something outside the list.");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Style\nAnswer: Custom direction");
    expect(clipboard.copiedText()).toContain("Note: Need something outside the list.");
    expect(clipboard.copiedText()).toContain("Field: style");
    expect(clipboard.copiedText()).not.toContain("npx --yes @andie/loopmark secrets");
    expect(remote.secretUploads).toHaveLength(0);
  });

  it("copies a fully blank session even when legacy fields were marked required", async () => {
    const groupedSession = normalizeSession({
      title: "Grouped review",
      groups: [
        {
          id: "blocked",
          title: "Previously required section",
          fields: [
            { id: "blocked_answer", type: "text", label: "Blocked answer", required: true },
            {
              id: "blocked_choice",
              type: "choice",
              label: "Blocked choice",
              required: true,
              mode: "single",
              options: ["A"]
            }
          ]
        }
      ]
    });
    await renderCloudApp(groupedSession);

    const user = userEvent.setup();
    installClipboard();

    await screen.findByRole("button", { name: /Previously required section/i });
    await user.click(screen.getByRole("button", { name: /Previously required section/i }));
    expect(screen.queryByLabelText(/Blocked answer/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
  });

  it("shows option descriptions directly and lets choices be cleared", async () => {
    const detailedSession = normalizeSession({
      title: "Detailed choices",
      fields: [
        {
          id: "style",
          type: "choice",
          label: "Style",
          default: "Paper Trail",
          options: [{ label: "Paper Trail", description: "Elegant document-like layout." }]
        }
      ]
    });
    await renderCloudApp(detailedSession);

    const user = userEvent.setup();

    await screen.findByText("Elegant document-like layout.");
    expect(screen.queryByLabelText("Note for Style")).not.toBeInTheDocument();
    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    expect(styleField.getByRole("button", { name: "Add note" })).toHaveAttribute("aria-expanded", "false");

    const option = screen.getByRole("button", { name: /Paper Trail/i });
    expect(option).toHaveClass("bg-paper-accent");
    await user.click(option);
    expect(option).not.toHaveClass("bg-paper-accent");
  });

  it("skips agent-prefilled answers instead of copying defaults", async () => {
    const prefilledSession = normalizeSession({
      title: "Prefilled review",
      fields: [
        { id: "scope", label: "Scope", type: "text", default: "Agent-proposed scope" },
        {
          id: "direction",
          label: "Direction",
          type: "choice",
          default: "Paper Trail",
          options: [{ label: "Paper Trail", description: "Agent-picked visual direction." }]
        },
        {
          id: "priority",
          label: "Rank priorities",
          type: "choice",
          mode: "ranking",
          options: ["Alpha", "Beta"]
        }
      ]
    });
    await renderCloudApp(prefilledSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Agent-proposed scope");
    const scopeField = within(document.querySelector("#field-scope") as HTMLElement);
    const directionField = within(document.querySelector("#field-direction") as HTMLElement);
    const priorityField = within(document.querySelector("#field-priority") as HTMLElement);
    await user.click(scopeField.getByRole("button", { name: "Skip answer" }));
    await user.click(directionField.getByRole("button", { name: "Skip answer" }));
    await user.click(priorityField.getByRole("button", { name: "Skip answer" }));

    expect(scopeField.getByRole("button", { name: "Answer skipped" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset Scope" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    const answerText = clipboard.copiedText();
    expect(answerText).toContain("Scope\nAnswer: [no answer]\nField: scope");
    expect(answerText).toContain("Direction\nAnswer: [no answer]\nField: direction");
    expect(answerText).toContain("Rank priorities\nAnswer: [no answer]\nField: priority");
    expect(answerText).not.toContain("Agent-proposed scope");
    expect(answerText).not.toContain("Paper Trail");
    expect(answerText).not.toContain("Choice 1: Alpha");
  });

  it("copies a choice note even after a selected option is cleared", async () => {
    const noteSession = normalizeSession({
      title: "Choice note",
      fields: [{ id: "decision", label: "Decision", type: "choice", options: ["A", "B"] }]
    });
    await renderCloudApp(noteSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Decision");
    const decisionField = within(document.querySelector("#field-decision") as HTMLElement);
    await user.click(decisionField.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByLabelText("Note for Decision"), "I am skipping the choices for now.");
    const option = screen.getByRole("button", { name: "A" });
    await user.click(option);
    await user.click(option);
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Answer: [no answer]");
    expect(clipboard.copiedText()).toContain("Note: I am skipping the choices for now.");
  });

  it("treats a blank Other selection as no answer for single choice", async () => {
    await renderCloudApp(session);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Style");
    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    const simpleOption = styleField.getByRole("button", { name: "Simple" });
    await user.click(simpleOption);
    expect(simpleOption).toHaveClass("bg-paper-accent");

    await user.click(styleField.getByRole("button", { name: "Other" }));

    expect(simpleOption).not.toHaveClass("bg-paper-accent");
    expect(styleField.getByLabelText("Other answer for Style")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Answer: [no answer]");
  });

  it("lets ranking items be removed without adding Other to ranking", async () => {
    const rankingSession = normalizeSession({
      title: "Ranking review",
      fields: [
        {
          id: "priority",
          type: "choice",
          label: "Rank priorities",
          mode: "ranking",
          options: ["Alpha", "Beta"]
        }
      ]
    });
    await renderCloudApp(rankingSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Rank priorities");
    const priorityField = within(document.querySelector("#field-priority") as HTMLElement);
    expect(priorityField.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();

    await user.click(priorityField.getByRole("button", { name: "Remove Alpha" }));
    expect(priorityField.queryByText("Alpha")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Choice 1: Beta");
    expect(clipboard.copiedText()).not.toContain("Choice 1: Alpha");
  });

  it("copies notes for ranking questions", async () => {
    const rankingSession = normalizeSession({
      title: "Ranking review",
      fields: [
        {
          id: "priority",
          type: "choice",
          label: "Rank priorities",
          mode: "ranking",
          options: ["Alpha", "Beta"]
        }
      ]
    });
    await renderCloudApp(rankingSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Rank priorities");
    const priorityField = within(document.querySelector("#field-priority") as HTMLElement);
    await user.click(priorityField.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByLabelText("Note for Rank priorities"), "Alpha is first because it is lower risk.");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Choice 1: Alpha");
    expect(clipboard.copiedText()).toContain("Choice 2: Beta");
    expect(clipboard.copiedText()).toContain("Note: Alpha is first because it is lower risk.");
  });

  it("resets a changed field after confirmation", async () => {
    await renderCloudApp(session);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();

    const notes = await screen.findByRole("textbox", { name: "Notes" });
    await user.type(notes, "Temporary edit");
    await user.click(screen.getByRole("button", { name: "Reset Notes" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "Notes" })).toHaveValue("");
  });

  it("shows the load error screen when the session request fails", async () => {
    const remote = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Loopmark session was not found." }), { status: 404 }))
    );
    const fillUrl = new URL(remote.fillUrl);
    window.history.pushState({}, "", `${fillUrl.pathname}${fillUrl.hash}`);

    render(<App />);

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("Loopmark session was not found.")).toBeInTheDocument();
  });

  it("shows the public homepage without fetching when visiting the root path", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Loopmark" })).toBeInTheDocument();
    expect(screen.getByText("Structured human input for AI agents.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy install command" })).toBeInTheDocument();
    expect(screen.getAllByText(/copy traceable answer text/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/encrypted secret bundle/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/local \.env file/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Private deployments are supported/i)).toBeInTheDocument();
    expect(screen.queryByText("Self-hosted service")).not.toBeInTheDocument();
    expect(screen.queryByText(/The default hosted service is this site/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent collects later/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/submits encrypted answers/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Unable to load Loopmark")).not.toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe("Loopmark - Human input for AI agents"));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses a single accessible name for the homepage brand link", async () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(await screen.findByRole("link", { name: "Loopmark" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("link", { name: "LoopmarkLoopmark" })).not.toBeInTheDocument();
  });

  it("lets visitors explore the handoff flow and secret path", async () => {
    window.history.pushState({}, "", "/");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Watch one handoff from Agent to User." })).toBeInTheDocument();
    expect(screen.getByLabelText("Loopmark handoff movie")).toBeInTheDocument();
    expect(screen.getByLabelText("Loopmark relay")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /01\s*Prepare question/i })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText("questions.json").length).toBeGreaterThan(0);
    expect(screen.getByText(/"title": "Need product direction"/i)).toBeInTheDocument();
    expect(screen.getByText(/"label": "Which direction should I take\?"/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /02\s*Loopmark form/i }));
    expect(screen.getByLabelText("Loopmark form preview")).toBeInTheDocument();
    expect(screen.getByText("Which direction should I take?")).toBeInTheDocument();
    expect(screen.getByText("Smallest viable change")).toBeInTheDocument();
    expect(screen.getByText("Broader cleanup")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /03\s*Answer/i }));
    expect(screen.getByText("Ship the smallest reliable path today.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /04\s*Resume/i }));
    expect(screen.getByText(/Need product direction Answers/)).toBeInTheDocument();
    expect(screen.getByText(/Answer: Smallest viable change/)).toBeInTheDocument();
    expect(screen.getByText(/Field: scope/)).toBeInTheDocument();
    expect(screen.queryByText(/npx --yes @andie\/loopmark secrets s_xxx/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Secret handling lane")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("switch", { name: /Show secret handling/i }));
    expect(screen.getByLabelText("Secret handling lane")).toBeInTheDocument();
    expect(screen.getByText("Secret field")).toBeInTheDocument();
    expect(screen.getByText("Encrypted bundle")).toBeInTheDocument();
    expect(screen.getByText(".env file")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /01\s*Prepare question/i }));
    expect(screen.getByText(/"id": "api_token"/i)).toBeInTheDocument();
    expect(screen.getByText(/"secret": true/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /02\s*Loopmark form/i }));
    expect(screen.getByText("Optional API token")).toBeInTheDocument();
    expect(screen.getByText("This value is omitted from Answer Text.")).toBeInTheDocument();
    expect(screen.queryByText("secret value")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /04\s*Resume/i }));
    expect(screen.getByText(/Answer: \[secret omitted\]/)).toBeInTheDocument();
    expect(screen.getByText(/npx --yes @andie\/loopmark secrets s_xxx/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Loopmark server/i })).not.toBeInTheDocument();
  });

  it("shows the public homepage when refreshing a root anchor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/#workflow");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Loopmark" })).toBeInTheDocument();
    expect(screen.queryByText("This Loopmark link is missing a valid session code.")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the public homepage when the root hash is not a valid encoded anchor", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/#%");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Loopmark" })).toBeInTheDocument();
    expect(screen.queryByText("This Loopmark link is missing a valid session code.")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("copies the homepage install command", async () => {
    const clipboard = installClipboard();
    window.history.pushState({}, "", "/");

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy install command" }));

    expect(clipboard.clipboard.writeText).toHaveBeenCalledWith("npx skills add andiedie/loopmark");
    expect(screen.getByText("Copied")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install command copied" })).toBeInTheDocument();
  });

  it("shows a homepage copy failure when clipboard writing is unavailable", async () => {
    const clipboard = installClipboard(async () => {
      throw new Error("Denied");
    });
    window.history.pushState({}, "", "/");

    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy install command" }));

    expect(clipboard.clipboard.writeText).toHaveBeenCalledWith("npx skills add andiedie/loopmark");
    expect(screen.getByText("Copy failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy install command failed" })).toBeInTheDocument();
  });

  it("shows a load error without fetching when a fill link has no session code", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s");

    render(<App />);

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("This Loopmark link is missing a valid session code.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a session envelope that does not belong to the link", async () => {
    const otherRemote = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    await renderCloudApp(session, {
      sessionResponse: new Response(JSON.stringify(otherRemote.envelope), { status: 200 })
    });

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("Loopmark session envelope does not match the link.")).toBeInTheDocument();
  });

  it("copies traceable Answer Text and uploads secret answers separately", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [
        { id: "notes", type: "text", label: "Notes" },
        { id: "token", label: "Local token", type: "text", secret: true }
      ]
    });
    const remote = await renderCloudApp(secretSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await user.type(await screen.findByRole("textbox", { name: "Notes" }), "Ready to copy");
    await user.type(screen.getByLabelText("Local token"), "secret-token");
    const tokenField = within(document.querySelector("#field-token") as HTMLElement);
    await user.click(tokenField.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByLabelText("Note for Local token"), "Use this only for the staging API.");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    const answerText = clipboard.copiedText();
    expect(answerText).toContain("Secret review Answers");
    expect(answerText).toContain("Notes\nAnswer: Ready to copy\nField: notes");
    expect(answerText).toContain("Local token\nAnswer: [secret omitted]\nNote: Use this only for the staging API.\nField: token");
    expect(answerText).toContain("npx --yes @andie/loopmark secrets");
    expect(answerText).toContain(remote.sessionId);
    expect(answerText).not.toContain("```loopmark-answer");
    expect(answerText).not.toContain("secret-token");
    expect(remote.secretUploads).toHaveLength(1);
    await expect(decryptFirstSecretUpload(remote)).resolves.toEqual({
      secrets: {
        token: {
          value: "secret-token"
        }
      }
    });
  });

  it("preserves secret values exactly in the encrypted upload", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    const remote = await renderCloudApp(secretSession);
    const user = userEvent.setup();
    installClipboard();

    await user.type(await screen.findByLabelText("Local token"), "  secret token  ");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    await expect(decryptFirstSecretUpload(remote)).resolves.toEqual({
      secrets: {
        token: {
          value: "  secret token  "
        }
      }
    });
  });

  it("skips a secret answer without uploading its value or note", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    const remote = await renderCloudApp(secretSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await user.type(await screen.findByLabelText("Local token"), "secret-token");
    const tokenField = within(document.querySelector("#field-token") as HTMLElement);
    await user.click(tokenField.getByRole("button", { name: "Add note" }));
    await user.type(screen.getByLabelText("Note for Local token"), "Use this only for staging.");
    await user.click(tokenField.getByRole("button", { name: "Skip answer" }));
    expect(screen.queryByLabelText("Note for Local token")).not.toBeInTheDocument();
    expect(tokenField.getByRole("button", { name: "Answer skipped" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Local token\nAnswer: [no secret value provided]\nField: token");
    expect(clipboard.copiedText()).not.toContain("Use this only for staging.");
    expect(clipboard.copiedText()).not.toContain("npx --yes @andie/loopmark secrets");
    expect(remote.secretUploads).toHaveLength(0);
  });

  it("shows a manual Answer Text fallback when clipboard writing fails without leaking secrets", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [
        { id: "notes", type: "text", label: "Notes" },
        { id: "token", label: "Local token", type: "text", secret: true }
      ]
    });
    await renderCloudApp(secretSession);
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: vi.fn(async () => {
          throw new Error("clipboard denied");
        })
      }
    });

    await user.type(await screen.findByRole("textbox", { name: "Notes" }), "Ready to copy");
    await user.type(screen.getByLabelText("Local token"), "secret-token");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    expect(await screen.findByText("Answers ready")).toBeInTheDocument();
    expect(screen.getByText("clipboard denied")).toBeInTheDocument();
    const fallback = screen.getByLabelText("Answer Text");
    const answerText = (fallback as HTMLTextAreaElement).value;
    expect(answerText).toContain("npx --yes @andie/loopmark secrets");
    expect(answerText).not.toContain("secret-token");
    expect(answerText).not.toContain("```loopmark-answer");
  });

  it("shows a preparation error when secret upload fails", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    await renderCloudApp(secretSession, {
      secretUploadResponse: new Response(JSON.stringify({ error: "R2 unavailable" }), { status: 503 })
    });
    const user = userEvent.setup();
    installClipboard();

    await user.type(await screen.findByLabelText("Local token"), "secret-token");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    expect(await screen.findByText("Unable to prepare answers")).toBeInTheDocument();
    expect(screen.getByText("R2 unavailable")).toBeInTheDocument();
  });

  it("keeps a secret field's normal note in Answer Text without uploading secrets", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    const remote = await renderCloudApp(secretSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    await screen.findByText("Local token");
    const tokenField = within(document.querySelector("#field-token") as HTMLElement);
    await user.click(await tokenField.findByRole("button", { name: "Add note" }));
    await user.type(screen.getByLabelText("Note for Local token"), "Public note without a value.");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));

    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());
    expect(clipboard.copiedText()).toContain("Note: Public note without a value.");
    expect(clipboard.copiedText()).not.toContain(`npx --yes @andie/loopmark secrets ${remote.sessionId}`);
    expect(remote.secretUploads).toHaveLength(0);
  });

  it("keeps an edited answer when reset confirmation is cancelled", async () => {
    await renderCloudApp(session);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();

    const notes = await screen.findByRole("textbox", { name: "Notes" });
    await user.type(notes, "Keep this edit");
    await user.click(screen.getByRole("button", { name: "Reset Notes" }));

    expect(notes).toHaveValue("Keep this edit");
  });

  it("resets Other input together with the choice answer", async () => {
    await renderCloudApp(session);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();

    await screen.findByText("Style");
    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    await user.click(styleField.getByRole("button", { name: "Other" }));
    await user.type(styleField.getByLabelText("Other answer for Style"), "Temporary answer");
    expect(styleField.getByLabelText("Other answer for Style")).toHaveValue("Temporary answer");

    await user.click(screen.getByRole("button", { name: "Reset Style" }));

    expect(styleField.queryByLabelText("Other answer for Style")).not.toBeInTheDocument();
    expect(styleField.getByRole("button", { name: "Other" })).not.toHaveClass("bg-paper-accent");
  });

  it("lets multiple choice use and clear Other alongside selected options", async () => {
    const multipleSession = normalizeSession({
      title: "Multiple choice",
      fields: [
        {
          id: "scope",
          label: "Scope",
          type: "choice",
          mode: "multiple",
          options: ["A", "B"]
        }
      ]
    });
    await renderCloudApp(multipleSession);

    const user = userEvent.setup();

    await screen.findByText("Scope");
    const scopeField = within(document.querySelector("#field-scope") as HTMLElement);
    await user.click(scopeField.getByRole("button", { name: "A" }));
    await user.click(scopeField.getByRole("button", { name: "Other" }));
    const otherInput = scopeField.getByLabelText("Other answer for Scope");
    await user.type(otherInput, "C");

    expect(scopeField.getByRole("button", { name: "A" })).toHaveClass("bg-paper-accent");
    expect(otherInput).toHaveValue("C");

    await user.click(scopeField.getByRole("button", { name: "Other" }));
    expect(scopeField.queryByLabelText("Other answer for Scope")).not.toBeInTheDocument();

    await user.click(scopeField.getByRole("button", { name: "Other" }));
    const reopenedOtherInput = scopeField.getByLabelText("Other answer for Scope");
    await user.type(reopenedOtherInput, "C");

    await user.click(scopeField.getByRole("button", { name: "A" }));
    expect(scopeField.getByRole("button", { name: "A" })).not.toHaveClass("bg-paper-accent");

    await user.clear(reopenedOtherInput);
    expect(scopeField.queryByLabelText("Other answer for Scope")).not.toBeInTheDocument();
  });

  it("renders grouped descriptions and collapses grouped sections", async () => {
    const groupedSession = normalizeSession({
      title: "Grouped review",
      description: "Top-level context for the review.",
      groups: [
        {
          id: "context",
          title: "Context",
          description: "Group-specific guidance.",
          fields: [{ id: "summary", label: "Summary", type: "text" }]
        }
      ]
    });
    await renderCloudApp(groupedSession);

    const user = userEvent.setup();

    expect(await screen.findByText("Top-level context for the review.")).toBeInTheDocument();
    expect(screen.getByText("Group-specific guidance.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Context/i }));

    expect(screen.queryByLabelText(/Summary/)).not.toBeInTheDocument();
  });

  it("lets users reveal and hide single-line secret answers without leaking copied Markdown", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    const remote = await renderCloudApp(secretSession);
    const user = userEvent.setup();
    const clipboard = installClipboard();

    const input = await screen.findByLabelText("Local token");
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByText("Secret value is omitted from the copied answer text and later written to a local file by the agent.")).toBeInTheDocument();

    await user.type(input, "secret-token");
    await user.click(screen.getByRole("button", { name: "Show Local token" }));
    expect(input).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide Local token" }));
    expect(input).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /copy answers/i }));
    await waitFor(() => expect(screen.getByText("Answers copied")).toBeInTheDocument());

    expect(clipboard.copiedText()).not.toContain("secret-token");
    await expect(decryptFirstSecretUpload(remote)).resolves.toMatchObject({
      secrets: {
        token: {
          value: "secret-token"
        }
      }
    });
  });

  it("hides a revealed secret answer after reset", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    await renderCloudApp(secretSession);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    const input = await screen.findByLabelText("Local token");
    await user.type(input, "temporary-token");
    await user.click(screen.getByRole("button", { name: "Show Local token" }));
    expect(input).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: "Reset Local token" }));

    const resetInput = screen.getByLabelText("Local token");
    expect(resetInput).toHaveAttribute("type", "password");
    await user.type(resetInput, "new-token");
    expect(resetInput).toHaveAttribute("type", "password");
  });

  it("lets users reveal and hide multiline secret answers", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true, multiline: true }]
    });
    await renderCloudApp(secretSession);
    const user = userEvent.setup();

    const textarea = await screen.findByLabelText("Local token");
    const showButton = screen.getByRole("button", { name: "Show Local token" });
    expect(showButton).toHaveAttribute("aria-pressed", "false");

    await user.type(textarea, "line one\nline two");
    await user.click(showButton);
    const hideButton = screen.getByRole("button", { name: "Hide Local token" });
    expect(hideButton).toHaveAttribute("aria-pressed", "true");
    await user.click(hideButton);
    expect(screen.getByRole("button", { name: "Show Local token" })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps multiline secret text visually hidden without webkit text security", async () => {
    vi.stubGlobal("CSS", { supports: vi.fn(() => false) });
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true, multiline: true }]
    });
    await renderCloudApp(secretSession);

    const textarea = await screen.findByLabelText("Local token");

    expect(getComputedStyle(textarea).color).toBe("rgba(0, 0, 0, 0)");
  });

  it("lets optional single choices toggle back to no answer", async () => {
    const optionalSession = normalizeSession({
      title: "Optional choice",
      fields: [{ id: "decision", label: "Decision", type: "choice", options: ["A", "B"] }]
    });
    await renderCloudApp(optionalSession);

    const user = userEvent.setup();

    const option = await screen.findByRole("button", { name: "A" });
    await user.click(option);
    expect(option).toHaveClass("bg-paper-accent");
    await user.click(option);

    expect(option).not.toHaveClass("bg-paper-accent");
  });
});
