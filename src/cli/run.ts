import type { Readable, Writable } from "node:stream";
import { parseInputJson, type NormalizedSession } from "../shared/schema";
import { LoopmarkInputError } from "../shared/errors";
import {
  collectRemoteResult,
  createRemoteSession,
  type RemoteCollectResult,
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
  collectRemoteResult: (
    receiptFile: string,
    options: { secretDir?: string }
  ) => Promise<RemoteCollectResult>;
};

const defaultDependencies: CliDependencies = {
  parseInputJson,
  createRemoteSession,
  collectRemoteResult
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
          "  loopmark collect <receipt-file> [--secret-dir DIR]",
          ""
        ].join("\n")
      );
      return 0;
    }

    if (parsedArgs.command === "collect") {
      const output = await dependencies.collectRemoteResult(parsedArgs.receiptFile, {
        secretDir: parsedArgs.secretDir ?? runtime.env.LOOPMARK_SECRET_DIR
      });
      runtime.stdout.write(`${JSON.stringify(output)}\n`);
      if (output.status === "pending") {
        runtime.stderr.write(`${output.message}\n`);
      }
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
      command: "collect";
      receiptFile: string;
      secretDir?: string;
    };

function parseArgs(args: string[]): ParsedArgs {
  if (args.includes("--help") || args.includes("-h")) {
    return { help: true };
  }

  if (args[0] === "collect") {
    const values = parseOptions(args.slice(1), new Set(["secret-dir"]));
    const receiptFile = values.positionals[0];
    if (!receiptFile || values.positionals.length > 1) {
      throw new Error("Usage: loopmark collect <receipt-file> [--secret-dir DIR]");
    }
    return {
      help: false,
      command: "collect",
      receiptFile,
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
