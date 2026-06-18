import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Check,
  Copy,
  FileKey2,
  Github,
  Lock,
  MessageSquareText,
  ShieldCheck,
  Terminal
} from "lucide-react";

const workflowSteps = [
  {
    title: "Agent asks only when it should",
    body: "Loopmark is for choices a model should not invent: scope, approvals, preferences, priorities, private context, and secrets."
  },
  {
    title: "The CLI creates an encrypted link",
    body: "A compact JSON session is encrypted locally, posted to the Worker, and returned as a public fill URL."
  },
  {
    title: "A human answers and copies Markdown",
    body: "The fill page keeps the questions readable, supports notes and rankings, and lets the human copy traceable Markdown back to the agent."
  },
  {
    title: "The agent reads Markdown",
    body: "Non-secret answers stay in the pasted Markdown. If secrets were omitted, the agent downloads the encrypted secret bundle with its local receipt."
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
  "Non-secret answers and notes stay visible in the pasted Markdown conversation.",
  "Secret values are omitted from Markdown and retrieved into a local .env file only when needed."
];

const installCommand = "npx skills add andiedie/loopmark";
type CopyStatus = "idle" | "copied" | "failed";

export function HomePage() {
  const [copyStatus, setCopyStatus] = useState<CopyStatus>("idle");
  const copyResetTimer = useRef<number | null>(null);

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
            Give agents a clean way to pause for the decisions that still belong to a person, then copy traceable
            Markdown back when you are done.
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
            <h2 className="font-serif text-3xl leading-tight">Designed around traceable Markdown and encrypted secrets.</h2>
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
              when to read pasted Markdown or download omitted secrets.
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
