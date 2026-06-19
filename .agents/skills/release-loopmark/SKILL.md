---
name: release-loopmark
description: "Release Loopmark to npm and Cloudflare."
disable-model-invocation: true
---

# Release Loopmark

Use this skill only when the user explicitly asks to publish or deploy Loopmark.

## Release Model

- Cloudflare deploys from `.github/workflows/deploy-cloudflare.yml` on push to `main`.
- npm publishes from `.github/workflows/publish.yml` on push to a `v*.*.*` tag.
- The npm tag must equal `v${package.json.version}`.
- npm versions are immutable. If the current package version already exists on npm, bump before publishing.

## Steps

1. Inspect the repository.

   Run from the repository root:

   ```sh
   git status --short --branch
   git log --oneline -5
   git remote -v
   ```

   Completion criterion: the current branch is `main`, the repository is clean or every local change is intentional, and the release target commit is known.

2. Check the package version and tag state.

   Read `package.json`, then check npm and Git:

   ```sh
   npm --cache /tmp/loopmark-npm-cache view @andie/loopmark versions --json
   git tag --points-at HEAD
   git tag --list 'v*' --sort=version:refname
   git ls-remote origin refs/heads/main refs/tags/vX.Y.Z
   ```

   If the npm versions array already contains `package.json.version`, bump to the next patch version:

   ```sh
   pnpm version X.Y.Z --no-git-tag-version
   ```

   Completion criterion: `package.json.version` is unpublished, and the intended tag `vX.Y.Z` does not already exist locally or remotely.

   If the intended tag already exists, treat it as a partial-release recovery instead of continuing the normal release path. Inspect the matching GitHub Actions run, then either rerun that failed run or bump to the next unpublished patch version before creating or pushing any tag. Do not push an already-existing tag and expect npm publishing to trigger.

3. Run local gates before pushing.

   ```sh
   CI=true pnpm lint
   CI=true pnpm typecheck
   CI=true pnpm test
   CI=true pnpm build
   CI=true pnpm test:e2e
   ```

   If pnpm tries to update dependency state in a restricted environment, rerun with the required filesystem approval rather than skipping the gate.

   Completion criterion: every gate exits 0.

4. Commit the release version, if changed.

   When a version bump was needed:

   ```sh
   git diff -- package.json
   git add package.json
   git commit -m "Bump package version to X.Y.Z"
   ```

   Completion criterion: `HEAD` contains the intended package version and `git status --short` is clean.

5. Create the npm release tag.

   ```sh
   git tag vX.Y.Z
   git tag --points-at HEAD
   ```

   Completion criterion: `vX.Y.Z` points at `HEAD`, and `package.json.version` is `X.Y.Z`.

6. Push main and the release tag.

   ```sh
   git push origin main vX.Y.Z
   ```

   Completion criterion: the push succeeds, and `git ls-remote origin refs/heads/main refs/tags/vX.Y.Z` shows both refs at the release commit.

7. Watch GitHub Actions to completion.

   Find the two runs:

   ```sh
   gh run list --repo Andiedie/loopmark --limit 10
   ```

   Watch both:

   ```sh
   gh run watch <npm-run-id> --repo Andiedie/loopmark --exit-status
   gh run watch <cloudflare-run-id> --repo Andiedie/loopmark --exit-status
   ```

   If a run fails, inspect it with `gh run view <id> --log-failed`, fix the cause, and repeat from the relevant earlier step.

   Completion criterion: `Publish to npm` and `Deploy Cloudflare` both complete with `conclusion: success` for the release commit.

8. Verify external state.

   Confirm npm:

   ```sh
   npm --cache /tmp/loopmark-npm-cache view @andie/loopmark version dist-tags --json
   ```

   Confirm Cloudflare serves the deployed app:

   ```sh
   curl --silent --show-error --location --max-time 20 https://loopmark.ssoo.fun/
   ```

   Then render the page in a browser and verify the homepage appears without the session-code error.

   Completion criterion: npm `latest` is `X.Y.Z`, `https://loopmark.ssoo.fun/` returns the built app, the rendered title is `Loopmark - Human input for AI agents`, and `Unable to load Loopmark` is absent.

9. Report the release.

   Include the commit, tag, npm workflow URL, Cloudflare workflow URL, npm version, site URL, and final `git status --short --branch`.

   Completion criterion: the report contains enough evidence for the user to audit npm and Cloudflare success without rerunning commands.
