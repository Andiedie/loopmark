import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/ui/App";
import { normalizeSession, type NormalizedSession } from "../src/shared/schema";

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

describe("Loopmark UI", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    window.history.pushState({}, "", "/");
  });

  it("loads a session, validates required fields, adds custom choice, and submits", async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      if (url.startsWith("/api/submit")) {
        expect(init?.body).toContain("Custom direction");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(groupedSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

    await screen.findByRole("button", { name: /Blocked section/i });
    await user.click(screen.getByRole("button", { name: /Blocked section/i }));
    expect(screen.queryByLabelText(/Blocked answer/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    await waitFor(() => expect(screen.getByLabelText(/Blocked answer/)).toBeInTheDocument());
    expect(screen.getByText(/required question needs an answer/i)).toBeInTheDocument();
  });

  it("keeps choice details collapsed until the user asks to edit them", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(detailedSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

    await screen.findByText("Elegant document-like layout.");
    expect(screen.queryByText("Details")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit details/i }));

    expect(screen.getByText("Selected details")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove Paper Trail/i })).not.toBeInTheDocument();
  });

  it("keeps custom options and edited descriptions when switching choices", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(rankingSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(lockedSession), { status: 200 });
      }

      if (url.startsWith("/api/submit")) {
        expect(init?.body).toContain("Updated style detail.");
        expect(init?.body).toContain("Updated ranking detail.");
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");
    const confirmMock = vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<App />);

    const notes = await screen.findByLabelText(/Notes/);
    await user.type(notes, "Temporary edit");
    await user.click(screen.getByRole("button", { name: "Reset Notes" }));

    expect(confirmMock).toHaveBeenCalled();
    expect(notes).toHaveValue("");
  });

  it("shows the load error screen when the session request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Forbidden", { status: 403 }))
    );
    window.history.pushState({}, "", "/s/test-token");

    render(<App />);

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("Session request failed with 403.")).toBeInTheDocument();
  });

  it("shows a submit error screen when the server rejects a locally valid answer", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      if (url.startsWith("/api/submit")) {
        return new Response("submit failed after validation", { status: 500 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

    await user.type(await screen.findByLabelText(/Notes/), "Ready to submit");
    await user.click(screen.getByRole("button", { name: "Simple" }));
    await user.click(screen.getByRole("button", { name: /submit inputs/i }));

    expect(await screen.findByText("Unable to load Loopmark")).toBeInTheDocument();
    expect(screen.getByText("submit failed after validation")).toBeInTheDocument();
  });

  it("keeps an edited answer when reset confirmation is cancelled", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");
    vi.spyOn(window, "confirm").mockReturnValue(false);

    const user = userEvent.setup();
    render(<App />);

    const notes = await screen.findByLabelText(/Notes/);
    await user.type(notes, "Keep this edit");
    await user.click(screen.getByRole("button", { name: "Reset Notes" }));

    expect(notes).toHaveValue("Keep this edit");
  });

  it("resets custom choice drafts together with the choice answer", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(session), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(groupedSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

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
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(secretSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    render(<App />);

    const input = await screen.findByLabelText(/Local token/);
    expect(input).toHaveAttribute("type", "password");
    expect(screen.getByText("Secret answer is written to a temporary file and omitted from stdout.")).toBeInTheDocument();
  });

  it("lets optional single choices toggle back to no answer", async () => {
    const optionalSession = normalizeSession({
      title: "Optional choice",
      fields: [{ id: "decision", label: "Decision", type: "choice", options: ["A", "B"] }]
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (url.startsWith("/api/session")) {
        return new Response(JSON.stringify(optionalSession), { status: 200 });
      }

      return new Response("Not found", { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.pushState({}, "", "/s/test-token");

    const user = userEvent.setup();
    render(<App />);

    const option = await screen.findByRole("button", { name: "A" });
    await user.click(option);
    expect(screen.getByRole("button", { name: /Edit details/i })).toBeInTheDocument();
    await user.click(option);

    expect(screen.queryByRole("button", { name: /Edit details/i })).not.toBeInTheDocument();
  });
});
