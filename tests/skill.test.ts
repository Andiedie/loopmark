import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readFixture(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

function frontmatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error("Missing YAML frontmatter.");
  }

  return Object.fromEntries(
    match[1]
      .split("\n")
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/))
      .filter((entry): entry is RegExpMatchArray => Boolean(entry))
      .map((entry) => [entry[1], entry[2]])
  );
}

describe("bundled Loopmark skill", () => {
  it("uses standard skill metadata and links its references", () => {
    const skill = readFixture("../skills/loopmark/SKILL.md");
    const metadata = frontmatter(skill);

    expect(metadata.name).toBe("loopmark");
    expect(metadata.description).toContain("Loopmark CLI");
    expect(metadata.description.length).toBeLessThanOrEqual(1024);
    expect(skill).not.toContain("[TODO");
    expect(skill).toContain("references/protocol.md");
    expect(skill).not.toContain("references/deployment.md");
    expect(skill).toContain("https://github.com/Andiedie/loopmark#self-hosting-on-cloudflare");
  });

  it("keeps a strict human-input boundary and avoids polling", () => {
    const skill = readFixture("../skills/loopmark/SKILL.md");

    expect(skill).toContain("Do not ask the human for information you can reasonably discover");
    expect(skill).toContain("real human decision");
    expect(skill).toContain("printf '%s\\n'");
    expect(skill).toContain("| npx --yes @andie/loopmark");
    expect(skill).toContain("npx --yes @andie/loopmark < /path/to/questions.json");
    expect(skill).toContain("npx --yes @andie/loopmark secrets s_xxx");
    expect(skill).toContain("`--yes` belongs to `npx`");
    expect(skill).toContain("Do not poll");
    expect(skill).toContain("Treat every field as optional");
    expect(skill).toContain("Do not include an `Other` option");
    expect(skill).toContain("Loopmark adds `Other` automatically");
    expect(skill).toContain("browser:control-in-app-browser");
    expect(skill).toContain("do not treat the browser as the answer transport");
    expect(skill).toContain("Do not scrape answers from the page");
    expect(skill).not.toContain("`required`");
    expect(skill).not.toContain("\"format\"");
    expect(skill).not.toContain("\"required\": true");
    expect(skill).not.toContain("pnpx @andie/loopmark");
    expect(skill).not.toContain("already on PATH");
    expect(skill).not.toContain("--no-open");
  });

  it("documents Vercel skills add as the agent skill install path", () => {
    const readme = readFixture("../README.md");

    expect(readme).toContain("npx skills add andiedie/loopmark");
    expect(readme).toContain("You do not need to install Loopmark globally");
    expect(readme).toContain("repository-installed skill");
    expect(readme).toContain("https://github.com/Andiedie/loopmark/blob/main/skills/loopmark/SKILL.md");
    expect(readme).toContain("https://github.com/Andiedie/loopmark/blob/main/skills/loopmark/references/protocol.md");
    expect(readme).not.toContain("lives in `skills/loopmark/SKILL.md`");
    expect(readme).not.toContain("skills experimental_sync");
    expect(readme).not.toContain("pnpx");
    expect(readme).not.toContain("pnpm add -D @andie/loopmark");
    expect(readme).not.toContain("npm install -g @andie/loopmark");
    expect(readme).not.toContain("--agent codex");
  });

  it("marks the release skill as internal-only", () => {
    const releaseSkill = readFixture("../.agents/skills/release-loopmark/SKILL.md");

    expect(releaseSkill).toContain("name: release-loopmark");
    expect(releaseSkill).toContain("metadata:\n  internal: true");
  });

  it("keeps README focused on human users instead of development workflow", () => {
    const readme = readFixture("../README.md");

    expect(readme).toContain("How It Works");
    expect(readme).toContain("Privacy And Secrets");
    expect(readme).toContain("Self-Hosting On Cloudflare");
    expect(readme).toContain("docs/operations/cloudflare.md");
    expect(readme).not.toContain("## Development");
    expect(readme).not.toContain("## Release");
  });

  it("keeps README Loopmark commands non-interactive for agents", () => {
    const readme = readFixture("../README.md");

    expect(readme).toContain("npx --yes @andie/loopmark < questions.json");
    expect(readme).toContain("npx --yes @andie/loopmark secrets s_xxx");
    expect(readme).toContain("npx --yes @andie/loopmark --base-url https://your-loopmark.example < questions.json");
    expect(readme).not.toContain("npx @andie/loopmark < questions.json");
    expect(readme).not.toContain("npx @andie/loopmark secrets s_xxx");
  });

  it("keeps design documentation aligned with pasted Answer Text transport", () => {
    const design = readFixture("../DESIGN.md");

    expect(design).toContain("copy Answer Text");
    expect(design).toContain("local `.env` retrieval");
    expect(design).toContain("## Detailed Layout Constraints");
    expect(design).toContain("Modals and drawers are not part of v1");
    expect(design).toContain("## Component Rules");
    expect(design).toContain("Icon-only buttons must have accessible labels");
    expect(design).toContain("## Accessibility And Motion");
    expect(design).toContain("Respect `prefers-reduced-motion`");
    expect(design).toContain("## Content Style");
    expect(design).toContain("Button copy uses clear verbs");
    expect(design).not.toContain("import-file");
    expect(design).not.toContain("imports Markdown");
  });

  it("keeps the skill directory out of the npm package", () => {
    const packageJson = JSON.parse(readFixture("../package.json")) as { files?: string[] };

    expect(packageJson.files).not.toContain("skills");
  });

  it("keeps custom base URL in the protocol and deployment details in the operations runbook", () => {
    const skill = readFixture("../skills/loopmark/SKILL.md");
    const protocol = readFixture("../skills/loopmark/references/protocol.md");
    const readme = readFixture("../README.md");
    const cloudflare = readFixture("../docs/operations/cloudflare.md");

    expect(protocol).toContain("Use another Loopmark server");
    expect(protocol).toContain("Create with inline stdin");
    expect(protocol).toContain("Create with file redirection");
    expect(protocol).toContain("npx --yes @andie/loopmark secrets s_xxx");
    expect(protocol).toContain("secretFile");
    expect(protocol).toContain("preview");
    expect(protocol).toContain("api_token=<redacted>");
    expect(protocol).toContain("## Opening Fill Pages In Agent Browsers");
    expect(protocol).toContain("browser:control-in-app-browser");
    expect(protocol).toContain("The in-app browser is only a presentation surface");
    expect(protocol).toContain("collapsed public note control");
    expect(protocol).toContain("All fields are optional");
    expect(protocol).toContain("Loopmark always adds a system `Other` option");
    expect(protocol).toContain("Choice answers may include a note");
    expect(protocol).toContain("## Pasted Answer Text Shape");
    expect(protocol).toContain("Answer: [secret omitted]");
    expect(protocol).not.toContain("`required`");
    expect(protocol).not.toContain("allowCustom");
    expect(protocol).not.toContain("editable");
    expect(protocol).not.toContain("{ \"value\", \"label\"");
    expect(protocol).toContain("npx --yes @andie/loopmark --base-url https://your-loopmark.example");
    expect(protocol).toContain("LOOPMARK_BASE_URL");
    expect(skill).toContain("#self-hosting-on-cloudflare");
    expect(readme).toContain("Self-Hosting On Cloudflare");
    expect(readme).toContain("docs/operations/cloudflare.md");
    expect(cloudflare).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(cloudflare).toContain("CLOUDFLARE_API_TOKEN");
    expect(cloudflare).toContain("Workers R2 Storage read permissions");
    expect(cloudflare).toContain("not an R2 object API token");
    expect(cloudflare).toContain("R2 edit, zone, and DNS permissions are not needed");
    expect(cloudflare).toContain("Keep the R2 bucket private");
    expect(cloudflare).toContain("does not configure Cloudflare routing");
  });

  it("keeps agent documentation discoverable from the repository entry point", () => {
    const agents = readFixture("../AGENTS.md");
    const context = readFixture("../CONTEXT.md");
    const documentation = readFixture("../docs/agents/documentation.md");
    const issueTracker = readFixture("../docs/agents/issue-tracker.md");
    const triageLabels = readFixture("../docs/agents/triage-labels.md");
    const domain = readFixture("../docs/agents/domain.md");

    expect(agents).toContain("CONTEXT.md");
    expect(agents).toContain("docs/agents/documentation.md");
    expect(agents).toContain("## Agent skills");
    expect(agents).toContain("docs/agents/issue-tracker.md");
    expect(agents).toContain("docs/agents/triage-labels.md");
    expect(agents).toContain("docs/agents/domain.md");
    expect(agents).toContain("docs/operations/cloudflare.md");
    expect(agents).toContain("pnpm exec vitest run tests/skill.test.ts --coverage=false");
    expect(context).toContain("R2 stores encrypted session envelopes");
    expect(context).toContain("Answer Text");
    expect(context).toContain("pnpm exec vitest run tests/skill.test.ts --coverage=false");
    expect(readFixture("../docs/README.md")).not.toContain("published with the package");
    expect(documentation).toContain("Treat `skills/loopmark/**` as published product protocol");
    expect(documentation).not.toContain("## Reseed Backup");
    expect(documentation).not.toContain("documentation-reseed-2026-06-19");
    expect(documentation).toContain("git diff --check");
    expect(documentation).toContain("pnpm exec vitest run tests/skill.test.ts --coverage=false");
    expect(issueTracker).toContain("Issues and PRDs for this repo live as GitHub issues");
    expect(issueTracker).toContain("PRs as a request surface: no.");
    expect(triageLabels).toContain("`needs-triage`");
    expect(triageLabels).toContain("`needs-info`");
    expect(triageLabels).toContain("`ready-for-agent`");
    expect(triageLabels).toContain("`ready-for-human`");
    expect(triageLabels).toContain("`wontfix`");
    expect(domain).toContain("Single-context repo.");
    expect(domain).toContain("No `CONTEXT-MAP.md` is used.");
  });
});
