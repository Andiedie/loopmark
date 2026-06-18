import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { normalizeSession, type NormalizedSession } from "../src/shared/schema";
import type { SubmitPayload } from "../src/shared/answer-state";
import {
  assertAnswerSubmissionEnvelope,
  createRemoteSessionPackage,
  decryptAnswerEnvelope,
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
};

type CloudSessionOptions = {
  onAnswer?: (payload: SubmitPayload, rawBody: string) => void | Promise<void>;
  submitResponse?: Response;
  sessionResponse?: Response;
};

async function installCloudSession(
  loadedSession: NormalizedSession,
  options: CloudSessionOptions = {}
): Promise<CloudSessionMock> {
  const remote = await createRemoteSessionPackage({
    session: loadedSession,
    baseUrl: "https://loopmark.test"
  });
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const path = new URL(url, "https://loopmark.test").pathname;

    if (path === `/api/sessions/${remote.sessionId}`) {
      return options.sessionResponse ?? new Response(JSON.stringify(remote.envelope), { status: 200 });
    }

    if (path === `/api/sessions/${remote.sessionId}/answer`) {
      const rawBody = String(init?.body ?? "");
      const submission = JSON.parse(rawBody) as unknown;
      assertAnswerSubmissionEnvelope(submission);
      const payload = await decryptAnswerEnvelope({ receipt: remote.receipt, envelope: submission.envelope });
      await options.onAnswer?.(payload, rawBody);
      return options.submitResponse ?? new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const fillUrl = new URL(remote.fillUrl);
  window.history.pushState({}, "", `${fillUrl.pathname}${fillUrl.hash}`);
  return { ...remote, fetchMock };
}

async function renderCloudApp(loadedSession: NormalizedSession, options?: CloudSessionOptions): Promise<CloudSessionMock> {
  const remote = await installCloudSession(loadedSession, options);
  render(<App />);
  return remote;
}

describe("Loopmark UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("loads a session, ignores legacy required flags, captures choice notes, and submits Other", async () => {
    await renderCloudApp(session, {
      onAnswer: (payload, rawBody) => {
        expect(payload.answers.notes).toEqual({
          type: "text",
          value: ""
        });
        expect(payload.answers.style).toEqual({
          type: "choice",
          items: [{ label: "Custom direction" }],
          note: "Need something outside the list."
        });
        expect(rawBody).not.toContain("Custom direction");
        expect(rawBody).not.toContain("Need something outside the list.");
      }
    });

    const user = userEvent.setup();

    expect((await screen.findAllByText("Need input")).length).toBeGreaterThan(0);
    expect(screen.queryByText(/required question needs an answer/i)).not.toBeInTheDocument();

    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    await user.click(styleField.getByRole("button", { name: "Other" }));
    await user.type(styleField.getByLabelText("Other answer for Style"), "Custom direction");
    await user.type(styleField.getByLabelText("Note for Style"), "Need something outside the list.");
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
  });

  it("submits a fully blank session even when legacy fields were marked required", async () => {
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

    await screen.findByRole("button", { name: /Previously required section/i });
    await user.click(screen.getByRole("button", { name: /Previously required section/i }));
    expect(screen.queryByLabelText(/Blocked answer/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
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
    expect(screen.getByLabelText("Note for Style")).toBeInTheDocument();

    const option = screen.getByRole("button", { name: /Paper Trail/i });
    expect(option).toHaveClass("bg-paper-accent");
    await user.click(option);
    expect(option).not.toHaveClass("bg-paper-accent");
  });

  it("submits a choice note even after a selected option is cleared", async () => {
    const noteSession = normalizeSession({
      title: "Choice note",
      fields: [{ id: "decision", label: "Decision", type: "choice", options: ["A", "B"] }]
    });
    await renderCloudApp(noteSession, {
      onAnswer: (payload) => {
        expect(payload.answers.decision).toEqual({
          type: "choice",
          items: null,
          note: "I am skipping the choices for now."
        });
      }
    });

    const user = userEvent.setup();

    await screen.findByText("Decision");
    await user.type(screen.getByLabelText("Note for Decision"), "I am skipping the choices for now.");
    const option = screen.getByRole("button", { name: "A" });
    await user.click(option);
    await user.click(option);
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
  });

  it("treats a blank Other selection as no answer for single choice", async () => {
    await renderCloudApp(session, {
      onAnswer: (payload) => {
        expect(payload.answers.style).toEqual({
          type: "choice",
          items: null
        });
      }
    });

    const user = userEvent.setup();

    await screen.findByText("Style");
    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    const simpleOption = styleField.getByRole("button", { name: "Simple" });
    await user.click(simpleOption);
    expect(simpleOption).toHaveClass("bg-paper-accent");

    await user.click(styleField.getByRole("button", { name: "Other" }));

    expect(simpleOption).not.toHaveClass("bg-paper-accent");
    expect(styleField.getByLabelText("Other answer for Style")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
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
    await renderCloudApp(rankingSession, {
      onAnswer: (payload) => {
        expect(payload.answers.priority).toEqual({
          type: "choice",
          items: [{ label: "Beta" }]
        });
      }
    });

    const user = userEvent.setup();

    await screen.findByText("Rank priorities");
    const priorityField = within(document.querySelector("#field-priority") as HTMLElement);
    expect(priorityField.queryByRole("button", { name: "Other" })).not.toBeInTheDocument();

    await user.click(priorityField.getByRole("button", { name: "Remove Alpha" }));
    expect(priorityField.queryByText("Alpha")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
  });

  it("submits notes for ranking questions", async () => {
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
    await renderCloudApp(rankingSession, {
      onAnswer: (payload) => {
        expect(payload.answers.priority).toEqual({
          type: "choice",
          items: [{ label: "Alpha" }, { label: "Beta" }],
          note: "Alpha is first because it is lower risk."
        });
      }
    });

    const user = userEvent.setup();

    await screen.findByText("Rank priorities");
    await user.type(screen.getByLabelText("Note for Rank priorities"), "Alpha is first because it is lower risk.");
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
  });

  it("resets a changed field after confirmation", async () => {
    await renderCloudApp(session);
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();

    const notes = await screen.findByLabelText(/Notes/);
    await user.type(notes, "Temporary edit");
    await user.click(screen.getByRole("button", { name: "Reset Notes" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(notes).toHaveValue("");
  });

  it("shows the load error screen when the session request fails", async () => {
    const remote = await createRemoteSessionPackage({
      session,
      baseUrl: "https://loopmark.test"
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 }))
    );
    const fillUrl = new URL(remote.fillUrl);
    window.history.pushState({}, "", `${fillUrl.pathname}${fillUrl.hash}`);

    render(<App />);

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("Session request failed with 403.")).toBeInTheDocument();
  });

  it("shows a load error without fetching when the link has no session code", async () => {
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

  it("shows a submit error screen when the server rejects a locally valid answer", async () => {
    await renderCloudApp(session, {
      submitResponse: new Response("submit failed after validation", { status: 500 })
    });

    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/Notes/), "Ready to submit");
    await user.click(screen.getByRole("button", { name: "Simple" }));
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("submit failed after validation")).toBeInTheDocument();
  });

  it("keeps an edited answer when reset confirmation is cancelled", async () => {
    await renderCloudApp(session);
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();

    const notes = await screen.findByLabelText(/Notes/);
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

  it("uses a password input for single-line secret answers", async () => {
    const secretSession = normalizeSession({
      title: "Secret review",
      fields: [{ id: "token", label: "Local token", type: "text", secret: true }]
    });
    await renderCloudApp(secretSession);

    const input = await screen.findByLabelText(/Local token/);
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByText("Secret answer is encrypted here and later written to a local file by the agent.")).toBeInTheDocument();
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
