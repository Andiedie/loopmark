import type { Readable, Writable } from "node:stream";
import { parseInputJson, type NormalizedSession } from "../shared/schema";
import { LoopmarkInputError } from "../shared/errors";
import { startLoopmarkServer, type RunningLoopmarkServer } from "../server/http";
import { openBrowser, type OpenBrowserResult } from "../server/open-browser";

export type CliRuntime = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Pick<Writable, "write">;
  stderr: Pick<Writable, "write">;
};

export type CliDependencies = {
  parseInputJson: (input: string) => NormalizedSession;
  startLoopmarkServer: (session: NormalizedSession) => Promise<RunningLoopmarkServer>;
  openBrowser: (url: string) => Promise<OpenBrowserResult>;
};

const defaultDependencies: CliDependencies = {
  parseInputJson,
  startLoopmarkServer,
  openBrowser
};

export async function runCli(
  runtime: CliRuntime,
  dependencies: CliDependencies = defaultDependencies
): Promise<number> {
  const args = new Set(runtime.argv.slice(2));

  if (args.has("--help") || args.has("-h")) {
    runtime.stdout.write("Usage: cat questions.json | loopmark [--no-open]\n");
    return 0;
  }

  let runningServer: RunningLoopmarkServer | undefined;

  try {
    const input = await readStdin(runtime.stdin);
    const session = dependencies.parseInputJson(input);
    runningServer = await dependencies.startLoopmarkServer(session);
    runtime.stderr.write(`Loopmark URL: ${runningServer.url}\n`);

    if (!args.has("--no-open") && runtime.env.LOOPMARK_NO_OPEN !== "1") {
      const opened = await dependencies.openBrowser(runningServer.url);
      if (!opened.ok) {
        runtime.stderr.write(`Could not open browser automatically: ${opened.error}\n`);
        runtime.stderr.write(`Open this URL manually: ${runningServer.url}\n`);
      }
    }

    const output = await runningServer.result;
    runtime.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error) {
    if (error instanceof LoopmarkInputError) {
      runtime.stderr.write(`${JSON.stringify(error.report)}\n`);
      return 1;
    }

    const message = error instanceof Error ? error.message : "Unexpected Loopmark error.";
    runtime.stderr.write(`${JSON.stringify({ status: "error", message })}\n`);
    return 1;
  } finally {
    if (runningServer) {
      await runningServer.close().catch(() => undefined);
    }
  }
}

function readStdin(stdin: Readable): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    let input = "";
    stdin.setEncoding("utf8");
    stdin.on("data", (chunk) => {
      input += chunk;
    });
    stdin.on("error", rejectPromise);
    stdin.on("end", () => {
      resolvePromise(input);
    });
  });
}
