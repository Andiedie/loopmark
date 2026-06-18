import type { Readable, Writable } from "node:stream";
import { parseInputJson, type NormalizedSession } from "../shared/schema";
import { LoopmarkInputError } from "../shared/errors";
import { assertSessionId } from "../shared/cloud-protocol";
import {
  createRemoteSession,
  downloadRemoteSecrets,
  type RemoteSecretsResult,
  type RemoteCreateResult
} from "./remote";

export type CliRuntime = {
  argv: string[];
  env: NodeJS.ProcessEnv;
  stdin: Readable;
  stdout: Pick<Writable, "write">;
  stderr: Pick<Writable, "write">;
};

export type CliDependencies = {
  parseInputJson: (input: string) => NormalizedSession;
  createRemoteSession: (
    session: NormalizedSession,
    options: { baseUrl?: string; receiptDir?: string }
  ) => Promise<RemoteCreateResult>;
  downloadRemoteSecrets: (
    sessionId: string,
    options: { receiptFile?: string; receiptDir?: string; secretDir?: string }
  ) => Promise<RemoteSecretsResult>;
};

const defaultDependencies: CliDependencies = {
  parseInputJson,
  createRemoteSession,
  downloadRemoteSecrets
};

export async function runCli(
  runtime: CliRuntime,
  dependencies: CliDependencies = defaultDependencies
): Promise<number> {
  try {
    const parsedArgs = parseArgs(runtime.argv.slice(2));

    if (parsedArgs.help) {
      runtime.stdout.write(
        [
          "Usage:",
          "  loopmark [--base-url URL] [--receipt-dir DIR] < questions.json",
          "  loopmark secrets <session-id> [--receipt FILE] [--receipt-dir DIR] [--secret-dir DIR]",
          ""
        ].join("\n")
      );
      return 0;
    }

    if (parsedArgs.command === "secrets") {
      const output = await dependencies.downloadRemoteSecrets(parsedArgs.sessionId, {
        receiptFile: parsedArgs.receiptFile,
        receiptDir: parsedArgs.receiptDir ?? runtime.env.LOOPMARK_RECEIPT_DIR,
        secretDir: parsedArgs.secretDir ?? runtime.env.LOOPMARK_SECRET_DIR
      });
      runtime.stderr.write(`Loopmark secrets: ${output.secretFile}\n`);
      runtime.stdout.write(`${JSON.stringify(output)}\n`);
      return 0;
    }

    const input = await readStdin(runtime.stdin);
    const session = dependencies.parseInputJson(input);
    const output = await dependencies.createRemoteSession(session, {
      baseUrl: parsedArgs.baseUrl ?? runtime.env.LOOPMARK_BASE_URL,
      receiptDir: parsedArgs.receiptDir ?? runtime.env.LOOPMARK_RECEIPT_DIR
    });
    runtime.stderr.write(`Loopmark URL: ${output.fillUrl}\n`);
    runtime.stderr.write(`Loopmark receipt: ${output.receiptFile}\n`);
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
  }
}

type ParsedArgs =
  | {
      help: true;
    }
  | {
      help: false;
      command: "create";
      baseUrl?: string;
      receiptDir?: string;
    }
  | {
      help: false;
      command: "secrets";
      sessionId: string;
      receiptFile?: string;
      receiptDir?: string;
      secretDir?: string;
    };

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  if (args[0] === "secrets") {
    const values = parseOptions(args.slice(1), new Set(["receipt", "receipt-dir", "secret-dir"]));
    const sessionId = values.positionals[0];
    if (!sessionId || values.positionals.length > 1) {
      throw new Error("Usage: loopmark secrets <session-id> [--receipt FILE] [--receipt-dir DIR] [--secret-dir DIR]");
    }
    return {
      help: false,
      command: "secrets",
      sessionId: assertSessionId(sessionId),
      receiptFile: values.options.get("receipt"),
      receiptDir: values.options.get("receipt-dir"),
      secretDir: values.options.get("secret-dir")
    };
  }

  const values = parseOptions(args, new Set(["base-url", "receipt-dir"]));
  if (values.positionals.length > 0) {
    throw new Error(`Unknown Loopmark argument: ${values.positionals[0]}`);
  }
  return {
    help: false,
    command: "create",
    baseUrl: values.options.get("base-url"),
    receiptDir: values.options.get("receipt-dir")
  };
}

function parseOptions(args: string[], allowedOptions: Set<string>): { options: Map<string, string>; positionals: string[] } {
  const options = new Map<string, string>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }

    const name = arg.slice(2);
    if (!allowedOptions.has(name)) {
      throw new Error(`Unknown Loopmark option: --${name}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Option --${name} requires a value.`);
    }
    options.set(name, value);
    index += 1;
  }

  return { options, positionals };
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
