<p align="center">
  <img src="assets/brand/loopmark-logo-readme.png" alt="Loopmark logo" width="96" height="96">
</p>

<h1 align="center">Loopmark</h1>

<p align="center">Loopmark helps AI agents ask humans at the right moment.</p>

Agents can inspect code, run tests, read docs, and search the web on their own. But some questions still belong to a person: product tradeoffs, preferences, approvals, private context, ranked priorities, or secrets. Loopmark gives agents a structured cloud handoff without making the agent keep a local process open.

## Install The Skill

Install the Loopmark Agent Skill with Vercel's `skills` CLI:

```bash
npx skills add andiedie/loopmark
```

That is the only installation step most users need. You do not need to install Loopmark globally or add it to your project dependencies before using the skill.

## How It Works

After the skill is installed, your agent learns:

- when it should ask you instead of guessing;
- when it should keep investigating without bothering you;
- how to create a small structured question session;
- how to run `@andie/loopmark` on demand with `npx`.

When the agent needs your input, it runs Loopmark once with a JSON session on stdin. The CLI encrypts the session, posts it to the Loopmark Worker, writes a local receipt file, prints a public fill URL, and exits immediately.

You open the URL, answer in the browser, copy the Markdown answer, and paste that Markdown back to the agent. If browser clipboard access is blocked, the page shows the same Markdown for manual copy. Non-secret answers live directly in that Markdown so the conversation stays traceable. If the Markdown says secrets were omitted, the agent runs the listed `npx --yes @andie/loopmark secrets <session-id>` command to download only the encrypted secret bundle into a local `.env` file.

```bash
npx --yes @andie/loopmark < questions.json
```

```bash
npx --yes @andie/loopmark secrets s_xxx
```

Use a self-hosted deployment with:

```bash
npx --yes @andie/loopmark --base-url https://your-loopmark.example < questions.json
```

or set `LOOPMARK_BASE_URL`.

## What Agents Should Ask

Loopmark is for human decisions, not agent shortcuts. The skill tells agents to use Loopmark for things like:

- product direction and scope boundaries;
- preferences between several reasonable options;
- approvals before an irreversible or risky action;
- private context that is not available in the repository;
- ranked priorities;
- sensitive values that should not appear in chat.

If the answer can be found through code, logs, tests, documentation, APIs, or web research, the agent should investigate first and should not ask you through Loopmark.

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

Cloudflare resources:

- Workers: hosts the API and static fill page.
- R2: stores encrypted session envelopes under `sessions/{sessionId}/session.json` and encrypted secret bundles under `sessions/{sessionId}/secrets.json` when secrets are submitted.
- R2 lifecycle: delete objects under `sessions/` after your desired retention window.
- Custom domain: bind your domain to the Worker manually in the Cloudflare dashboard. Keep the R2 bucket private; Loopmark does not need an R2 public or custom domain.

Recommended bucket name:

```text
loopmark-sessions
```

If you choose another bucket name, update `wrangler.jsonc`.

GitHub Actions secrets for the included deploy workflow:

- `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account ID.
- `CLOUDFLARE_API_TOKEN`: Cloudflare API token with account-scoped Workers Scripts edit and Workers R2 Storage read permissions.

Use a custom API token from Cloudflare profile API Tokens, not an R2 object API token, because the workflow deploys a Worker. Scope it to the one Cloudflare account that owns the Worker and R2 bucket. R2 edit, zone, and DNS permissions are not needed when the R2 bucket, lifecycle, and custom domain are managed manually.

GitHub Actions variable, either repository-level or on the `production` environment:

- `LOOPMARK_BASE_URL`: optional public URL for the deployment, for example `https://loopmark.ssoo.fun`. The workflow uses it only as the GitHub environment URL; it does not configure Cloudflare routing.

Manual Cloudflare dashboard setup:

1. Create the private R2 bucket, normally `loopmark-sessions`.
2. Add an R2 lifecycle rule for prefix `sessions/`, for example delete after 1 day.
3. Create a least-privilege API token for GitHub Actions.
4. Add your custom domain to the deployed Worker, for example `loopmark.ssoo.fun`.
5. Keep the R2 bucket private. Clients should call the Worker API, never R2 directly.

## For Agent Authors

The skill contains the operational protocol at `skills/loopmark/SKILL.md` and `skills/loopmark/references/protocol.md`. Humans normally do not need to write Loopmark JSON by hand; the installed skill teaches the agent to generate the session, run the CLI, wait for pasted Markdown, and download omitted secrets only when needed.
