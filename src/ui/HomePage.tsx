import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Check,
  Cloud,
  Copy,
  Database,
  FileText,
  FileKey2,
  Github,
  KeyRound,
  Link2,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Terminal,
  UserRound
} from "lucide-react";

const workflowSteps = [
  {
    title: "Prepare question",
    body: "The agent investigates first, then writes a compact question session only when a human decision is still needed."
  },
  {
    title: "Open a Loopmark form",
    body: "Loopmark turns that session into an encrypted public fill page without making the agent keep a local server open."
  },
  {
    title: "Answer in the browser",
    body: "The user reviews a document-like form, edits choices or notes, and keeps sensitive values out of the conversation."
  },
  {
    title: "Resume with Answer Text",
    body: "The user pastes traceable answer text back to the agent. If secrets were omitted, the agent fetches them into a local .env file."
  }
];

const fitItems = [
  "Product tradeoffs",
  "Scope boundaries",
  "Risky approvals",
  "Ranked priorities",
  "Private context",
  "Sensitive values"
];

const trustItems = [
  "The public link carries the session code in the URL hash.",
  "The Worker and R2 store encrypted session envelopes and encrypted secret bundles only.",
  "Non-secret answers and notes stay visible in the pasted Answer Text conversation.",
  "Secret values are omitted from Answer Text and retrieved into a local .env file only when needed."
];

type HandoffStepId = "prepare" | "form" | "answer" | "resume";
type HandoffStep = {
  id: HandoffStepId;
  label: string;
  title: string;
  body: string;
  agentState: string;
  userState: string;
  artifactLabel: string;
};

const handoffSteps: HandoffStep[] = [
  {
    id: "prepare",
    label: "Prepare question",
    title: "The agent prepares one small question packet.",
    body: "It asks only after checking what it can already learn from code, logs, tests, docs, or web research.",
    agentState: "Writes questions.json",
    userState: "No interruption yet",
    artifactLabel: "questions.json"
  },
  {
    id: "form",
    label: "Loopmark form",
    title: "Loopmark turns it into a focused browser form.",
    body: "The CLI encrypts locally, the Worker serves encrypted session state, and the user only sees a clean fill page.",
    agentState: "Sends fill URL",
    userState: "Opens Loopmark form",
    artifactLabel: "public fill URL"
  },
  {
    id: "answer",
    label: "Answer",
    title: "The user answers as a document, not a chat scramble.",
    body: "Choices, notes, rankings, and optional secret fields stay in one readable place before copying the final result.",
    agentState: "Waits, no polling",
    userState: "Answers and copies",
    artifactLabel: "completed form"
  },
  {
    id: "resume",
    label: "Resume",
    title: "The agent resumes from pasted Answer Text.",
    body: "Non-secret answers stay human-readable in the conversation. Secret values are omitted and fetched locally only when needed.",
    agentState: "Reads Answer Text",
    userState: "Pastes answer",
    artifactLabel: "answer.txt"
  }
];

const questionJsonExample = `{
  "title": "Need product direction",
  "fields": [
    {
      "id": "scope",
      "label": "Which direction should I take?",
      "type": "choice",
      "mode": "single",
      "options": [
        "Smallest viable change",
        "Broader cleanup"
      ]
    }
  ]
}`;

const secretQuestionJsonExample = `{
  "title": "Need product direction",
  "fields": [
    {
      "id": "scope",
      "label": "Which direction should I take?",
      "type": "choice",
      "mode": "single",
      "options": [
        "Smallest viable change",
        "Broader cleanup"
      ]
    },
    {
      "id": "api_token",
      "label": "Optional API token",
      "type": "text",
      "secret": true
    }
  ]
}`;

const answerTextExample = `Need product direction Answers

Which direction should I take?
Answer: Smallest viable change
Note: Ship the smallest reliable path today.
Field: scope`;

const secretAnswerTextExample = `${answerTextExample}

Optional API token
Answer: [secret omitted]
Field: api_token

Secrets
Secret values were omitted. Run this on the agent machine:
npx --yes @andie/loopmark secrets s_xxx`;

const installCommand = "npx skills add andiedie/loopmark";
type CopyStatus = "idle" | "copied" | "failed";

export function HomePage() {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const [activeHandoffStepId, setActiveHandoffStepId] = useState<HandoffStepId>("prepare");
  const [showSecretPath, setShowSecretPath] = useState(false);
  const copyResetTimer = useRef<number | null>(null);
  const activeHandoffStep = handoffSteps.find((step) => step.id === activeHandoffStepId) ?? handoffSteps[0];

  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    const anchor = decodeHashAnchor(window.location.hash);
    const target = anchor ? document.getElementById(anchor) : null;

    if (typeof target?.scrollIntoView === "function") {
      window.requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    }
  }, []);

  async function copyInstallCommand() {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }

    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
    }

    copyResetTimer.current = window.setTimeout(() => setCopyStatus("idle"), 2000);
  }

  return (
    <main className="min-h-screen bg-paper-50 text-paper-ink">
      <header className="border-b border-paper-line bg-paper-50">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between gap-4 px-5 py-4 md:px-8 lg:px-10">
          <a href="/" className="flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent">
            <img src="/icon-192.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8 shrink-0" />
            <span className="font-serif text-xl leading-none">Loopmark</span>
          </a>
          <nav className="hidden items-center gap-6 text-sm text-paper-muted md:flex" aria-label="Primary">
            <a className="hover:text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent" href="#workflow">
              Workflow
            </a>
            <a className="hover:text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent" href="#handoff">
              Flow
            </a>
            <a className="hover:text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent" href="#install">
              Install
            </a>
            <a className="hover:text-paper-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent" href="#privacy">
              Privacy
            </a>
          </nav>
          <a
            href="https://github.com/Andiedie/loopmark"
            className="inline-flex h-9 min-w-max items-center justify-center gap-2 border border-paper-line bg-white px-3 text-sm font-medium text-paper-ink transition-colors hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent"
          >
            <Github aria-hidden className="size-4" />
            GitHub
          </a>
        </div>
      </header>

      <section className="relative isolate overflow-hidden border-b border-paper-line">
        <img
          src="/icon-512.png"
          alt=""
          aria-hidden="true"
          width={512}
          height={512}
          className="pointer-events-none absolute left-1/2 top-10 -z-10 h-72 w-72 -translate-x-1/2 opacity-[0.07] md:top-6 md:h-[26rem] md:w-[26rem]"
        />
        <div className="mx-auto flex min-h-[64svh] w-full max-w-5xl flex-col items-center justify-center px-5 py-14 text-center md:px-8">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-paper-accent">Cloud human input handoff</p>
          <h1 className="mt-5 font-serif text-6xl leading-none md:text-7xl">Loopmark</h1>
          <p className="mt-5 max-w-2xl text-xl leading-8 text-paper-ink">Structured human input for AI agents.</p>
          <p className="mt-4 max-w-3xl text-base leading-7 text-paper-muted">
            Give agents a clean way to pause for the decisions that still belong to a person, then copy traceable answer
            text back when you are done.
          </p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row">
            <a
              href="#install"
              className="inline-flex h-10 min-w-max items-center justify-center gap-2 border border-paper-accent bg-paper-accent px-4 text-sm font-medium text-white transition-colors hover:bg-paper-accentDark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent"
            >
              Install the skill
              <ArrowRight aria-hidden className="size-4" />
            </a>
            <a
              href="#workflow"
              className="inline-flex h-10 min-w-max items-center justify-center border border-paper-line bg-white px-4 text-sm font-medium text-paper-ink transition-colors hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent"
            >
              See workflow
            </a>
          </div>
        </div>
      </section>

      <section id="workflow" className="border-b border-paper-line px-5 py-12 md:px-8 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)]">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-paper-accent">Workflow</p>
            <h2 className="mt-3 font-serif text-4xl leading-tight">A structured handoff, not another chat interruption.</h2>
          </div>
          <ol className="grid min-w-0 gap-0">
            {workflowSteps.map((step, index) => (
              <li key={step.title} className="grid gap-4 border-b border-paper-line py-5 last:border-b-0 md:grid-cols-[4rem_minmax(0,1fr)]">
                <span className="font-serif text-3xl leading-none text-paper-accent tabular-nums">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <span className="block font-serif text-2xl leading-8">{step.title}</span>
                  <span className="mt-2 block text-sm leading-6 text-paper-muted">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="handoff" className="border-b border-paper-line px-5 py-12 md:px-8 lg:px-10">
        <div className="mx-auto w-full max-w-7xl">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.72fr)_minmax(0,1.28fr)] lg:items-end">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.14em] text-paper-accent">Interactive flow</p>
              <h2 className="mt-3 font-serif text-4xl leading-tight">Watch one handoff from Agent to User.</h2>
              <p className="mt-4 max-w-xl text-sm leading-6 text-paper-muted">
                A Loopmark exchange is just four visible moments: prepare a question, open a form, answer, and resume
                from Answer Text.
              </p>
            </div>

            <div className="grid gap-4 border-y border-paper-line py-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">Current moment</p>
                <p className="mt-2 text-sm leading-6 text-paper-ink">{activeHandoffStep.title}</p>
                <p className="text-sm leading-6 text-paper-muted">{activeHandoffStep.artifactLabel}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showSecretPath}
                aria-label="Show secret handling"
                className="inline-flex h-10 min-w-max items-center gap-3 border border-paper-line bg-white px-3 text-sm font-medium text-paper-ink transition-colors hover:bg-paper-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent"
                onClick={() => setShowSecretPath((current) => !current)}
              >
                <span
                  aria-hidden="true"
                  className={`flex h-5 w-9 items-center border transition-colors ${
                    showSecretPath ? "justify-end border-paper-accent bg-paper-accent" : "justify-start border-paper-line bg-paper-100"
                  }`}
                >
                  <span className="mx-0.5 h-4 w-4 bg-white" />
                </span>
                {showSecretPath ? "With secrets" : "No secrets"}
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-2 md:grid-cols-4" aria-label="Handoff step controls">
            {handoffSteps.map((step, index) => {
              const active = step.id === activeHandoffStepId;

              return (
                <button
                  key={step.id}
                  type="button"
                  aria-pressed={active}
                  className={`min-w-0 border px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent ${
                    active ? "border-paper-accent bg-paper-accent text-white" : "border-paper-line bg-white text-paper-ink hover:bg-paper-100"
                  }`}
                  onClick={() => setActiveHandoffStepId(step.id)}
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="font-serif text-3xl leading-none tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                    <span className={active ? "text-white" : "text-paper-accent"}>{handoffStepIcon(step.id)}</span>
                  </span>
                  <span className="mt-3 block text-sm font-medium leading-5">{step.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-8 border-y border-paper-line py-6" role="group" aria-label="Loopmark handoff movie">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] lg:items-stretch">
              <MovieActorPanel
                title="Agent"
                icon={<Bot aria-hidden className="size-5" />}
                active={activeHandoffStep.id === "prepare" || activeHandoffStep.id === "resume"}
                state={activeHandoffStep.agentState}
                body={
                  activeHandoffStep.id === "prepare"
                    ? "The agent asks only after it has done its own homework."
                    : activeHandoffStep.id === "resume"
                      ? "The agent reads the pasted Answer Text and continues the task."
                      : "The agent can stop working while the user answers."
                }
              />

              <div className="grid gap-3 border border-paper-line bg-white p-4 text-center lg:content-center" aria-label="Loopmark relay">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">Loopmark</p>
                <div className="grid gap-3">
                  <RelayMark icon={<Terminal aria-hidden className="size-4" />} label="CLI" body="encrypts locally" />
                  <RelayMark icon={<Cloud aria-hidden className="size-4" />} label="Worker" body="serves ciphertext" />
                </div>
              </div>

              <MovieActorPanel
                title="User"
                icon={<UserRound aria-hidden className="size-5" />}
                active={activeHandoffStep.id === "form" || activeHandoffStep.id === "answer"}
                state={activeHandoffStep.userState}
                body={
                  activeHandoffStep.id === "form"
                    ? "The user opens a focused fill page instead of answering in chat."
                    : activeHandoffStep.id === "answer"
                      ? "The user edits the answer and copies the final Answer Text."
                      : "The user sees only the link or the final answer moment."
                }
              />
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-accent">{activeHandoffStep.label}</p>
                <h3 className="mt-3 font-serif text-3xl leading-tight">{activeHandoffStep.title}</h3>
                <p className="mt-3 text-sm leading-6 text-paper-muted">{activeHandoffStep.body}</p>
                {showSecretPath ? <SecretLane /> : null}
              </div>

              <div className="min-w-0">
                <p className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">Example artifact</p>
                <HandoffArtifactPreview stepId={activeHandoffStep.id} showSecretPath={showSecretPath} />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-paper-line px-5 py-12 md:px-8 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-2">
          <div className="min-w-0">
            <MessageSquareText aria-hidden className="mb-5 size-6 text-paper-accent" />
            <h2 className="font-serif text-3xl leading-tight">Use it where guessing would be expensive.</h2>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {fitItems.map((item) => (
                <div key={item} className="flex items-start gap-3 text-sm leading-6 text-paper-ink">
                  <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-paper-accent" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>

          <div id="privacy" className="min-w-0">
            <ShieldCheck aria-hidden className="mb-5 size-6 text-paper-accent" />
            <h2 className="font-serif text-3xl leading-tight">Designed around traceable Answer Text and encrypted secrets.</h2>
            <ul className="mt-6 grid gap-4">
              {trustItems.map((item) => (
                <li key={item} className="flex items-start gap-3 text-sm leading-6 text-paper-muted">
                  <Lock aria-hidden className="mt-0.5 size-4 shrink-0 text-paper-accent" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section id="install" className="px-5 py-12 md:px-8 lg:px-10">
        <div className="mx-auto grid w-full max-w-7xl gap-10 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <div>
            <Terminal aria-hidden className="mb-5 size-6 text-paper-accent" />
            <h2 className="font-serif text-4xl leading-tight">Install the agent skill.</h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-paper-muted">
              Most users only need the skill. It teaches the agent when to ask, how to create a Loopmark session, and
              when to read pasted Answer Text or download omitted secrets.
            </p>
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 text-sm font-medium text-paper-ink">
              <FileKey2 aria-hidden className="size-4 text-paper-accent" />
              Skill install
            </div>
            <div className="mt-4 grid min-w-0 bg-paper-100 sm:flex">
              <pre className="min-w-0 flex-1 overflow-x-auto p-4 text-xs leading-6 text-paper-ink sm:text-sm"><code>{installCommand}</code></pre>
              <button
                type="button"
                className="inline-flex min-w-max items-center justify-center gap-2 border-t border-paper-line px-4 py-3 text-sm font-medium text-paper-ink transition-colors hover:bg-paper-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-paper-accent sm:border-l sm:border-t-0 sm:py-0"
                aria-label={copyButtonLabel(copyStatus)}
                onClick={() => {
                  void copyInstallCommand();
                }}
              >
                {copyStatus === "copied" ? <Check aria-hidden className="size-4 text-paper-accent" /> : <Copy aria-hidden className="size-4" />}
                {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy"}
              </button>
            </div>
            <p className="mt-5 text-sm leading-6 text-paper-muted">
              Private deployments are supported for teams that want to run the Worker and storage in their own Cloudflare account.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function MovieActorPanel({
  title,
  icon,
  active,
  state,
  body
}: {
  title: string;
  icon: ReactNode;
  active: boolean;
  state: string;
  body: string;
}) {
  return (
    <div className={`min-w-0 border p-5 ${active ? "border-paper-accent bg-paper-100" : "border-paper-line bg-white"}`}>
      <div className="flex items-start justify-between gap-4">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center border ${active ? "border-paper-accent bg-paper-accent text-white" : "border-paper-line text-paper-accent"}`}>
          {icon}
        </span>
        <span className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">{active ? "Active" : "Waiting"}</span>
      </div>
      <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">{title}</p>
      <p className="mt-2 font-serif text-2xl leading-tight">{state}</p>
      <p className="mt-3 text-sm leading-6 text-paper-muted">{body}</p>
    </div>
  );
}

function RelayMark({ icon, label, body }: { icon: ReactNode; label: string; body: string }) {
  return (
    <div className="border border-paper-line bg-paper-50 p-3">
      <span className="mx-auto flex h-9 w-9 items-center justify-center border border-paper-line text-paper-accent">{icon}</span>
      <p className="mt-3 text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">{label}</p>
      <p className="mt-1 text-xs leading-5 text-paper-muted">{body}</p>
    </div>
  );
}

function SecretLane() {
  return (
    <div className="mt-5 border-y border-paper-line py-4" role="group" aria-label="Secret handling lane">
      <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.14em] text-paper-accent">
        <KeyRound aria-hidden className="size-4" />
        Secret handling
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <SecretLaneItem icon={<Lock aria-hidden className="size-4" />} label="Secret field" body="Typed by the user, omitted from Answer Text." />
        <SecretLaneItem icon={<Database aria-hidden className="size-4" />} label="Encrypted bundle" body="Stored as ciphertext for later retrieval." />
        <SecretLaneItem icon={<FileKey2 aria-hidden className="size-4" />} label=".env file" body="Downloaded locally with the agent receipt." />
      </div>
    </div>
  );
}

function SecretLaneItem({ icon, label, body }: { icon: ReactNode; label: string; body: string }) {
  return (
    <div className="border border-paper-line bg-paper-100 p-3">
      <span className="flex h-8 w-8 items-center justify-center border border-paper-line bg-white text-paper-accent">{icon}</span>
      <p className="mt-3 text-sm font-medium leading-5 text-paper-ink">{label}</p>
      <p className="mt-1 text-xs leading-5 text-paper-muted">{body}</p>
    </div>
  );
}

function HandoffArtifactPreview({ stepId, showSecretPath }: { stepId: HandoffStepId; showSecretPath: boolean }) {
  if (stepId === "prepare") {
    return <CodeArtifact label="questions.json" code={showSecretPath ? secretQuestionJsonExample : questionJsonExample} />;
  }

  if (stepId === "form") {
    return <MockLoopmarkForm answered={false} showSecretPath={showSecretPath} />;
  }

  if (stepId === "answer") {
    return <MockLoopmarkForm answered showSecretPath={showSecretPath} />;
  }

  return <CodeArtifact label="answer.txt" code={showSecretPath ? secretAnswerTextExample : answerTextExample} />;
}

function CodeArtifact({ label, code }: { label: string; code: string }) {
  return (
    <div className="min-w-0 border border-paper-line bg-white">
      <div className="flex items-center gap-2 border-b border-paper-line px-4 py-3 text-sm font-medium text-paper-ink">
        <FileText aria-hidden className="size-4 text-paper-accent" />
        {label}
      </div>
      <pre className="overflow-x-auto p-4 text-xs leading-6 text-paper-ink">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function MockLoopmarkForm({ answered, showSecretPath }: { answered: boolean; showSecretPath: boolean }) {
  return (
    <div className="border border-paper-line bg-white p-4" aria-label="Loopmark form preview">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-paper-line pb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-paper-ink">
          <img src="/icon-192.png" alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6 shrink-0" />
          Loopmark
        </div>
        <div className="flex items-center gap-2 text-xs text-paper-muted">
          <Link2 aria-hidden className="size-3.5 text-paper-accent" />
          /s#lm1_...
        </div>
      </div>

      <div className="py-5">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-accent">Need product direction</p>
        <h4 className="mt-2 font-serif text-2xl leading-tight">Which direction should I take?</h4>
        <p className="mt-2 text-sm leading-6 text-paper-muted">I checked the repository and need one product call before editing.</p>
      </div>

      <div className="grid gap-2">
        <MockOption selected={answered} label="Smallest viable change" description="Ship the narrow reliable path today." />
        <MockOption selected={false} label="Broader cleanup" description="Spend more time simplifying the surrounding module." />
      </div>

      <div className="mt-4 border border-paper-line bg-paper-50 p-3">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-paper-muted">Note</p>
        <p className="mt-2 text-sm leading-6 text-paper-ink">
          {answered ? "Ship the smallest reliable path today." : "Optional context for the agent."}
        </p>
      </div>

      {showSecretPath ? (
        <div className="mt-4 border border-paper-line bg-paper-100 p-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-paper-accent">
            <Lock aria-hidden className="size-4" />
            Optional API token
          </div>
          <div className="mt-3 border border-paper-line bg-white px-3 py-2 font-mono text-sm text-paper-muted">
            {answered ? "••••••••••••" : "Password field"}
          </div>
          <p className="mt-2 text-xs leading-5 text-paper-muted">This value is omitted from Answer Text.</p>
        </div>
      ) : null}

      <div className="mt-5 flex justify-end">
        <span className="inline-flex h-9 items-center gap-2 border border-paper-accent bg-paper-accent px-3 text-sm font-medium text-white">
          <Copy aria-hidden className="size-4" />
          Copy answers
        </span>
      </div>
    </div>
  );
}

function MockOption({ selected, label, description }: { selected: boolean; label: string; description: string }) {
  return (
    <div className={`border p-3 ${selected ? "border-paper-accent bg-paper-accent text-white" : "border-paper-line bg-white text-paper-ink"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center border ${selected ? "border-white" : "border-paper-line"}`}>
          {selected ? <Check aria-hidden className="size-3.5" /> : null}
        </span>
        <span>
          <span className="block text-sm font-medium leading-5">{label}</span>
          <span className={`mt-1 block text-xs leading-5 ${selected ? "text-white/80" : "text-paper-muted"}`}>{description}</span>
        </span>
      </div>
    </div>
  );
}

function handoffStepIcon(id: HandoffStepId) {
  switch (id) {
    case "prepare":
      return <FileText aria-hidden className="size-5" />;
    case "form":
      return <Link2 aria-hidden className="size-5" />;
    case "answer":
      return <UserRound aria-hidden className="size-5" />;
    case "resume":
      return <MessageSquareText aria-hidden className="size-5" />;
  }
}

function decodeHashAnchor(hash: string): string | null {
  const rawAnchor = hash.replace(/^#/, "");

  if (!rawAnchor) {
    return null;
  }

  try {
    return decodeURIComponent(rawAnchor);
  } catch {
    return null;
  }
}

function copyButtonLabel(status: CopyStatus): string {
  if (status === "copied") {
    return "Install command copied";
  }

  if (status === "failed") {
    return "Copy install command failed";
  }

  return "Copy install command";
}
