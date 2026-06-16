import { createReadStream, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = process.argv[2] ?? "examples/simple.json";
const resolvedExample = resolve(root, examplePath);
const cliPath = resolve(root, "dist/cli/index.js");
const webIndexPath = resolve(root, "dist/web/index.html");

if (!existsSync(resolvedExample)) {
  process.stderr.write(`Example JSON not found: ${examplePath}\n`);
  process.exit(1);
}

if (!existsSync(cliPath) || !existsSync(webIndexPath)) {
  process.stderr.write("Building Loopmark before starting the example...\n");
  await run(packageCommand("pnpm"), ["build"], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"]
  });
}

const child = spawn(process.execPath, [cliPath], {
  cwd: root,
  stdio: ["pipe", "inherit", "inherit"],
  env: process.env
});

createReadStream(resolvedExample).pipe(child.stdin);
process.exitCode = await waitForExit(child);

function packageCommand(command) {
  return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command, args, options) {
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

function waitForExit(childProcess) {
  return new Promise((resolvePromise, rejectPromise) => {
    childProcess.on("error", rejectPromise);
    childProcess.on("exit", (code) => {
      resolvePromise(code ?? 1);
    });
  });
}
