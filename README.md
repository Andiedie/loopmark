# Loopmark

Loopmark helps AI agents ask humans at the right moment.

Agents can inspect code, run tests, read docs, and search the web on their own. But some questions still belong to a person: product tradeoffs, preferences, approvals, private local context, ranked priorities, or secrets. Loopmark gives agents a local, structured way to pause, ask, and continue.

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
- how to run `@andie/loopmark` on demand with `npx`, `pnpx`, or the package runner available in your environment.

When the agent needs your input, it starts a temporary local Loopmark page and opens it in your browser. You answer the questions there. Loopmark sends the final structured answers back to the agent through stdout, while URLs, logs, and validation errors stay on stderr.

## What Agents Should Ask

Loopmark is for human decisions, not agent shortcuts. The skill tells agents to use Loopmark for things like:

- product direction and scope boundaries;
- preferences between several reasonable options;
- approvals before an irreversible or risky action;
- local private context that is not available in the repository;
- ranked priorities;
- sensitive values that should not appear in chat.

If the answer can be found through code, logs, tests, documentation, APIs, or web research, the agent should investigate first and should not ask you through Loopmark.

## Privacy And Secrets

Loopmark runs locally. Secret answers are written to a local temporary file and omitted from the final JSON answer payload. The agent receives a file path, not the secret value, and should read it only when the task truly requires it.

## For Agent Authors

The skill contains the operational protocol at `skills/loopmark/SKILL.md` and `skills/loopmark/references/protocol.md`. Humans normally do not need to write Loopmark JSON by hand; the installed skill teaches the agent to generate the session, run the CLI, and parse the result.
