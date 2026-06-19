<p align="center">
  <img src="assets/brand/loopmark-logo-readme.png" alt="Loopmark logo" width="96" height="96">
</p>

<h1 align="center">Loopmark</h1>

<p align="center">Loopmark helps AI agents ask humans at the right moment.</p>

Agents can inspect code, run tests, read docs, and search the web on their own. Some questions still belong to a person: product tradeoffs, preferences, approvals, private context, ranked priorities, or secrets. Loopmark gives agents a structured cloud handoff without keeping a local process open.

## Install The Skill

Install the Loopmark Agent Skill with Vercel's `skills` CLI:

```bash
npx skills add andiedie/loopmark
```

That is the only installation step most users need. You do not need to install Loopmark globally or add it to your project dependencies before using the skill.

## How It Works

When the agent needs human input, it creates a compact JSON question session and runs Loopmark once:

```bash
npx --yes @andie/loopmark < questions.json
```

The CLI encrypts the session, posts it to the Loopmark Worker, writes a local receipt file, prints a public fill URL, and exits. The human opens the URL, answers in the browser, clicks Copy answers, and pastes the copied Markdown back to the agent.

Non-secret answers and notes live directly in the pasted Markdown so the conversation stays traceable. If the Markdown says secrets were omitted, the agent downloads only the encrypted secret bundle:

```bash
npx --yes @andie/loopmark secrets s_xxx
```

Use a self-hosted deployment with:

```bash
npx --yes @andie/loopmark --base-url https://your-loopmark.example < questions.json
```

or set `LOOPMARK_BASE_URL`.

## What Agents Should Ask

Loopmark is for human decisions, not agent shortcuts. Use it for:

- product direction and scope boundaries;
- preferences between several reasonable options;
- approvals before irreversible or risky actions;
- private context unavailable in the repository;
- ranked priorities;
- sensitive values that should not appear in chat.

If the answer can be found through code, logs, tests, documentation, APIs, or web research, the agent should investigate first and should not ask through Loopmark.

## Privacy And Secrets

Loopmark uses end-to-end encryption for question sessions and secrets:

- The public fill link contains only a `sessionCode` in the URL hash.
- The Worker and R2 store encrypted question-session envelopes and encrypted secret bundles only.
- Browser answers are copied as Markdown. Non-secret answers and notes are visible in Markdown; secret values are omitted.
- The local receipt file contains the secret decryption key and should not be shared.
- Secret answers are encrypted in the browser, uploaded as ciphertext, downloaded with `npx --yes @andie/loopmark secrets`, and written to a local `.env` file.

The agent receives a file path for secret answers, not the secret value, and should read it only when the task truly requires it.

## Self-Hosting On Cloudflare

The default service is `https://loopmark.ssoo.fun`. Forks can deploy their own Worker and use `--base-url` or `LOOPMARK_BASE_URL`.

Cloudflare self-hosting uses a Worker plus a private R2 bucket, normally `loopmark-sessions`. The included GitHub Actions deploy workflow expects:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- optional `LOOPMARK_BASE_URL` GitHub Actions variable for the production environment URL

For bucket lifecycle, API token scope, custom domain setup, dry-run checks, and deployment verification, read the [Cloudflare operations guide](https://github.com/Andiedie/loopmark/blob/main/docs/operations/cloudflare.md).

## For Agent Authors

The operational protocol lives in `skills/loopmark/SKILL.md` and `skills/loopmark/references/protocol.md`. Humans normally do not need to write Loopmark JSON by hand; the installed skill teaches the agent to generate the session, run the CLI, wait for pasted Markdown, and download omitted secrets only when needed.
