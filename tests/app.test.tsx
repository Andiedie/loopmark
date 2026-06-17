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

const session: NormalizedSession = {
  title: "Need input",
  groups: [
    {
      id: "questions",
      title: "Need input",
      fields: [
        {
          id: "notes",
          type: "text",
          label: "Notes",
          required: true,
          multiline: false,
          secret: false,
          format: "plain"
        },
        {
          id: "style",
          type: "choice",
          label: "Style",
          required: true,
          mode: "single",
          options: [
            { id: "simple", label: "Simple", value: "simple" },
            { id: "complete", label: "Complete", value: "complete" }
          ],
          defaultItems: [],
          allowCustom: true,
          editable: true
        }
      ]
    }
  ]
};

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

  it("loads a session, validates required fields, adds custom choice, and submits", async () => {
    await renderCloudApp(session, {
      onAnswer: (payload, rawBody) => {
        expect(payload.answers.style).toEqual({
          type: "choice",
          items: [{ label: "Custom direction" }]
        });
        expect(rawBody).not.toContain("Custom direction");
      }
    });

    const user = userEvent.setup();

    expect((await screen.findAllByText("Need input")).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));
    expect((await screen.findAllByText(/required question needs an answer/i)).length).toBeGreaterThan(0);

    await user.type(screen.getByLabelText(/Notes/), "Ship a polished v1");
    expect(screen.queryByLabelText("Add custom answer label")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add custom answer/i }));
    await user.type(screen.getByLabelText("Add custom answer label"), "Custom direction");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("button", { name: /Custom direction/i })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByText("Inputs submitted")).toBeInTheDocument());
  });

  it("expands a collapsed group when the first validation issue is inside it", async () => {
    const groupedSession: NormalizedSession = {
      title: "Grouped review",
      groups: [
        {
          id: "ready",
          title: "Already answered",
          fields: [
            {
              id: "summary",
              type: "text",
              label: "Summary",
              required: false,
              multiline: false,
              secret: false,
              format: "plain"
            }
          ]
        },
        {
          id: "blocked",
          title: "Blocked section",
          fields: [
            {
              id: "blocked_answer",
              type: "text",
              label: "Blocked answer",
              required: true,
              multiline: false,
              secret: false,
              format: "plain"
            }
          ]
        }
      ]
    };
    await renderCloudApp(groupedSession);

    const user = userEvent.setup();

    await screen.findByRole("button", { name: /Blocked section/i });
    await user.click(screen.getByRole("button", { name: /Blocked section/i }));
    expect(screen.queryByLabelText(/Blocked answer/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByLabelText(/Blocked answer/)).toBeInTheDocument());
    expect(screen.getByText(/required question needs an answer/i)).toBeInTheDocument();
  });

  it("keeps choice details collapsed until the user asks to edit them", async () => {
    await renderCloudApp(session);

    const user = userEvent.setup();

    await screen.findByText("Style");
    await user.click(screen.getByRole("button", { name: "Simple" }));

    expect(screen.queryByText("Selected details")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Add custom answer/i }));
    expect(screen.queryByRole("button", { name: /Edit details/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Cancel/i }));
    await user.click(screen.getByRole("button", { name: /Edit details/i }));

    expect(screen.getByText("Selected details")).toBeInTheDocument();
    expect(screen.getByLabelText("Answer label 1")).toHaveValue("Simple");
    expect(screen.queryByRole("button", { name: /Add custom answer/i })).not.toBeInTheDocument();
  });

  it("shows option descriptions before editing and hides unavailable remove actions", async () => {
    const detailedSession: NormalizedSession = {
      title: "Detailed choices",
      groups: [
        {
          id: "questions",
          title: "Detailed choices",
          fields: [
            {
              id: "style",
              type: "choice",
              label: "Style",
              required: true,
              mode: "single",
              options: [
                {
                  id: "paper",
                  label: "Paper Trail",
                  description: "Elegant document-like layout.",
                  value: "paper"
                }
              ],
              defaultItems: [
                {
                  id: "paper",
                  label: "Paper Trail",
                  description: "Elegant document-like layout.",
                  value: "paper"
                }
              ],
              allowCustom: true,
              editable: true
            }
          ]
        }
      ]
    };
    await renderCloudApp(detailedSession);

    const user = userEvent.setup();

    await screen.findByText("Elegant document-like layout.");
    expect(screen.queryByText("Details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit details/i }));

    expect(screen.getByText("Selected details")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Paper Trail/i })).not.toBeInTheDocument();
  });

  it("keeps custom options and edited descriptions when switching choices", async () => {
    await renderCloudApp(session);

    const user = userEvent.setup();

    await screen.findByText("Style");
    await user.click(screen.getByRole("button", { name: /Add custom answer/i }));
    await user.type(screen.getByLabelText("Add custom answer label"), "Custom direction");
    await user.type(screen.getByLabelText("Add custom answer description"), "Persist this custom answer.");
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await user.click(screen.getByRole("button", { name: "Complete" }));
    expect(screen.getByRole("button", { name: /Custom direction/ })).toBeInTheDocument();
    expect(screen.getByText("Persist this custom answer.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Simple" }));
    await user.click(screen.getByRole("button", { name: /Edit details/i }));
    await user.clear(screen.getByLabelText("Answer description 1"));
    await user.type(screen.getByLabelText("Answer description 1"), "Edited description survives switching.");
    await user.click(screen.getByRole("button", { name: /Done editing/i }));
    await user.click(screen.getByRole("button", { name: "Complete" }));

    expect(screen.getByText("Edited description survives switching.")).toBeInTheDocument();
  });

  it("keeps ranking editors focused while labels change", async () => {
    const rankingSession: NormalizedSession = {
      title: "Ranking review",
      groups: [
        {
          id: "questions",
          title: "Ranking review",
          fields: [
            {
              id: "priority",
              type: "choice",
              label: "Rank priorities",
              required: true,
              mode: "ranking",
              options: [
                { id: "alpha", label: "Alpha", value: "alpha" },
                { id: "beta", label: "Beta", value: "beta" }
              ],
              defaultItems: [
                { id: "alpha", label: "Alpha", value: "alpha" },
                { id: "beta", label: "Beta", value: "beta" }
              ],
              allowCustom: true,
              editable: true
            }
          ]
        }
      ]
    };
    await renderCloudApp(rankingSession);

    const user = userEvent.setup();

    await screen.findByText("Rank priorities");
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    await user.click(screen.getByLabelText("Ranking label 1"));
    await user.keyboard("X");

    expect(screen.getByLabelText("Ranking label 1")).toHaveFocus();

    await user.keyboard("Y");

    expect(screen.getByLabelText("Ranking label 1")).toHaveValue("AlphaXY");
  });

  it("keeps choice and ranking labels read-only when custom answers are disabled", async () => {
    const lockedSession = normalizeSession({
      title: "Locked labels",
      fields: [
        {
          id: "style",
          type: "choice",
          label: "Pick a style",
          mode: "single",
          allowCustom: false,
          default: "Paper Trail",
          options: [
            { label: "Paper Trail", description: "Elegant document layout." },
            { label: "Plain Form", description: "Minimal plain controls." }
          ]
        },
        {
          id: "priority",
          type: "choice",
          label: "Rank priorities",
          mode: "ranking",
          allowCustom: false,
          options: [
            { label: "Visual fidelity", description: "Match the selected design direction." },
            { label: "Protocol clarity", description: "Keep the JSON compact." }
          ]
        }
      ]
    });
    await renderCloudApp(lockedSession, {
      onAnswer: (payload, rawBody) => {
        expect(JSON.stringify(payload)).toContain("Updated style detail.");
        expect(JSON.stringify(payload)).toContain("Updated ranking detail.");
        expect(rawBody).not.toContain("Updated style detail.");
        expect(rawBody).not.toContain("Updated ranking detail.");
      }
    });

    const user = userEvent.setup();

    await screen.findByText("Pick a style");
    const styleField = within(document.querySelector("#field-style") as HTMLElement);
    await user.click(styleField.getByRole("button", { name: "Edit details" }));
    expect(styleField.queryByLabelText("Answer label 1")).not.toBeInTheDocument();
    const styleDescription = styleField.getByLabelText("Answer description 1");
    await user.clear(styleDescription);
    await user.click(styleDescription);
    await user.paste("Updated style detail.");
    await user.click(styleField.getByRole("button", { name: "Done editing" }));

    const priorityField = within(document.querySelector("#field-priority") as HTMLElement);
    await user.click(priorityField.getByRole("button", { name: "Edit details" }));
    expect(priorityField.queryByLabelText("Ranking label 1")).not.toBeInTheDocument();
    const rankingDescription = priorityField.getByLabelText("Ranking description 1");
    await user.clear(rankingDescription);
    await user.click(rankingDescription);
    await user.paste("Updated ranking detail.");
    expect(rankingDescription).toHaveValue("Updated ranking detail.");
    await user.click(priorityField.getByRole("button", { name: "Done editing" }));
    expect(priorityField.getByText("Updated ranking detail.")).toBeInTheDocument();

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

  it("resets custom choice drafts together with the choice answer", async () => {
    await renderCloudApp(session);
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();

    await screen.findByText("Style");
    await user.click(screen.getByRole("button", { name: /Add custom answer/i }));
    await user.type(screen.getByLabelText("Add custom answer label"), "Temporary custom");
    await user.click(screen.getByRole("button", { name: /^add$/i }));
    expect(screen.getByRole("button", { name: /Temporary custom/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Reset Style" }));

    expect(screen.queryByRole("button", { name: /Temporary custom/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Edit details/i })).not.toBeInTheDocument();
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
    expect(screen.getByRole("button", { name: /Edit details/i })).toBeInTheDocument();
    await user.click(option);

    expect(screen.queryByRole("button", { name: /Edit details/i })).not.toBeInTheDocument();
  });
});
