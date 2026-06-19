# Cloudflare Operations

## Purpose

This runbook covers self-hosting Loopmark on Cloudflare Workers with private R2 storage. It keeps deployment details out of the public README while preserving the operational facts future agents need before changing infrastructure or release workflows.

## Read When

- Deploying, self-hosting, or dry-running the Cloudflare Worker.
- Changing `wrangler.jsonc`, `.github/workflows/deploy-cloudflare.yml`, Worker routes, R2 bindings, or custom domain behavior.
- Updating README self-hosting guidance.

## Source Of Truth

- Worker config: `wrangler.jsonc`.
- Worker API and R2 object keys: `src/server/worker.ts`.
- Deploy workflow: `.github/workflows/deploy-cloudflare.yml`.
- Package scripts: `package.json`.
- Default public base URL: `src/shared/cloud-protocol.ts`.

## Invariants

- The default hosted service is `https://loopmark.ssoo.fun`.
- The Worker serves static assets and runs first for `/api/*`.
- The R2 binding is `LOOPMARK_SESSIONS`.
- The recommended private bucket name is `loopmark-sessions`; if it changes, update `wrangler.jsonc`.
- R2 stores encrypted objects only:
  - `sessions/{sessionId}/session.json`
  - `sessions/{sessionId}/secrets.json`
- Non-secret answers are not stored in R2. They are copied as Answer Text and pasted back to the agent.
- Keep the R2 bucket private. Clients should call the Worker API, never R2 directly.
- The GitHub environment URL may use `LOOPMARK_BASE_URL`, but that variable does not configure Cloudflare routing.

## Procedure

1. Create a private R2 bucket, normally `loopmark-sessions`.
2. Add an R2 lifecycle rule for prefix `sessions/`, for example delete after 1 day.
3. Create a Cloudflare API token for GitHub Actions.
   - Use a custom API token from Cloudflare profile API Tokens, not an R2 object API token.
   - Scope it to the one Cloudflare account that owns the Worker and R2 bucket.
   - R2 edit, zone, and DNS permissions are not needed when the bucket, lifecycle, and custom domain are managed manually.
4. Add GitHub Actions secrets:
   - `CLOUDFLARE_ACCOUNT_ID`: Cloudflare account id.
   - `CLOUDFLARE_API_TOKEN`: account-scoped token with Workers Scripts edit and Workers R2 Storage read permissions.
5. Optionally set the GitHub Actions variable `LOOPMARK_BASE_URL` at repository or `production` environment scope so deployments display the public environment URL.
6. Deploy with the workflow or run locally:

```bash
pnpm deploy:cloudflare
```

7. Bind a custom domain such as `loopmark.ssoo.fun` to the deployed Worker in the Cloudflare dashboard.

Loopmark does not need an R2 public bucket or R2 custom domain.

Use a custom service from agents with:

```bash
npx --yes @andie/loopmark --base-url https://your-loopmark.example < questions.json
```

or set `LOOPMARK_BASE_URL` in the agent runtime.

## Verification

- Local build: `pnpm build:web`.
- Cloudflare dry run: `pnpm check:cloudflare`.
- CI deploy workflow validates with `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e` before deploy.
- After deploy, check `/api/health` returns JSON with `service: "loopmark"` and `protocol: 1`.
- Create a short session against the deployed base URL, open the fill URL, copy Answer Text, and verify any secret value is omitted from Answer Text and downloadable only with `loopmark secrets`.

## Update When

- R2 bucket names, bindings, object keys, custom domain setup, Worker routes, GitHub Actions permissions, or deployment scripts change.
- The default hosted service changes.
- Loopmark stops using R2 only for encrypted session envelopes and encrypted secret bundles.
