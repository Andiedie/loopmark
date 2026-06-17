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
    expect(skill).toContain("npx @andie/loopmark < /path/to/questions.json");
    expect(skill).toContain("npx @andie/loopmark collect /path/to/s_xxx.receipt.json");
    expect(skill).toContain("Do not poll");
    expect(skill).not.toContain("pnpx @andie/loopmark");
    expect(skill).not.toContain("already on PATH");
    expect(skill).not.toContain("--no-open");
  });

  it("documents Vercel skills add as the agent skill install path", () => {
    const readme = readFixture("../README.md");

    expect(readme).toContain("npx skills add andiedie/loopmark");
    expect(readme).toContain("You do not need to install Loopmark globally");
    expect(readme).not.toContain("skills experimental_sync");
    expect(readme).not.toContain("pnpx");
    expect(readme).not.toContain("pnpm add -D @andie/loopmark");
    expect(readme).not.toContain("npm install -g @andie/loopmark");
    expect(readme).not.toContain("--agent codex");
  });

  it("keeps README focused on human users instead of development workflow", () => {
    const readme = readFixture("../README.md");

    expect(readme).toContain("How It Works");
    expect(readme).toContain("Privacy And Secrets");
    expect(readme).toContain("Self-Hosting On Cloudflare");
    expect(readme).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(readme).not.toContain("## Development");
    expect(readme).not.toContain("## Release");
  });

  it("publishes the skill directory with the npm package", () => {
    const packageJson = JSON.parse(readFixture("../package.json")) as { files?: string[] };

    expect(packageJson.files).toContain("skills");
  });

  it("keeps custom base URL in the protocol and deployment details in the README", () => {
    const skill = readFixture("../skills/loopmark/SKILL.md");
    const protocol = readFixture("../skills/loopmark/references/protocol.md");
    const readme = readFixture("../README.md");

    expect(protocol).toContain("Use another Loopmark server");
    expect(protocol).toContain("npx @andie/loopmark --base-url https://your-loopmark.example");
    expect(protocol).toContain("LOOPMARK_BASE_URL");
    expect(skill).toContain("#self-hosting-on-cloudflare");
    expect(readme).toContain("Self-Hosting On Cloudflare");
    expect(readme).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(readme).toContain("CLOUDFLARE_API_TOKEN");
    expect(readme).toContain("Workers R2 Storage read permissions");
    expect(readme).toContain("R2 edit, zone, and DNS permissions are not needed");
    expect(readme).toContain("not an R2 object API token");
    expect(readme).toContain("Keep the R2 bucket private");
    expect(readme).toContain("The workflow uses it only as the GitHub environment URL");
  });
});
