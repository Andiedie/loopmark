import { spawn, type SpawnOptions } from "node:child_process";
import { createReadStream, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { startLocalLoopmarkServer } from "../src/server/local-server";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = process.argv[2] ?? "examples/simple.json";
const resolvedExample = resolve(root, examplePath);
const cliPath = resolve(root, "dist/cli/index.js");
const webRoot = resolve(root, "dist/web");
const webIndexPath = resolve(webRoot, "index.html");

if (!existsSync(resolvedExample)) {
  process.stderr.write(`Example JSON not found: ${examplePath}\n`);
  process.exit(1);
}

process.stderr.write("Building Loopmark before starting the local example...\n");
await run(packageCommand("pnpm"), ["build"], {
  cwd: root,
  stdio: ["ignore", "ignore", "inherit"]
});

if (!existsSync(cliPath) || !existsSync(webIndexPath)) {
  process.stderr.write("Loopmark build did not produce the expected CLI and web assets.\n");
  process.exit(1);
}

const server = await startLocalLoopmarkServer(webRoot);
process.stderr.write(`Local Loopmark server: ${server.url}\n`);

try {
  const child = spawn(process.execPath, [cliPath, "--base-url", server.url], {
    cwd: root,
    stdio: ["pipe", "inherit", "inherit"],
    env: process.env
  });

  createReadStream(resolvedExample).pipe(child.stdin);
  const code = await waitForExit(child);
  process.exitCode = code;

  if (code === 0) {
    process.stderr.write(
      [
        "",
        "The local Loopmark server is still running for this try session.",
        "Open the printed Loopmark URL, copy answers, then paste the Markdown back to the agent.",
        "If the Markdown says secrets were omitted, run its Loopmark secrets command on this machine.",
        "Press Ctrl+C here when you are done."
      ].join("\n")
    );
    process.stderr.write("\n");
    await waitForShutdown();
  }
} finally {
  await server.close();
}

function packageCommand(command: string): string {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command: string, args: string[], options: SpawnOptions): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const childProcess = spawn(command, args, options);

    childProcess.on("error", rejectPromise);
    childProcess.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

function waitForExit(childProcess: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolvePromise, rejectPromise) => {
    childProcess.on("error", rejectPromise);
    childProcess.on("exit", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}

function waitForShutdown(): Promise<void> {
  return new Promise((resolvePromise) => {
    const stop = () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolvePromise();
    };

    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
