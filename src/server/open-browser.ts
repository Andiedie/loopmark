import { spawn } from "node:child_process";

export type BrowserCommand = {
  command: string;
  args: string[];
};

export type OpenBrowserResult =
  | { ok: true; command: BrowserCommand }
  | { ok: false; command?: BrowserCommand; error: string };

const EARLY_EXIT_WINDOW_MS = 500;

export function getBrowserCommand(url: string, platform: NodeJS.Platform = process.platform): BrowserCommand {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }

  if (platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }

  return { command: "xdg-open", args: [url] };
}

export async function openBrowser(url: string, platform: NodeJS.Platform = process.platform): Promise<OpenBrowserResult> {
  const command = getBrowserCommand(url, platform);
  const first = await runOpenCommand(command);

  if (first.ok || platform !== "linux") {
    return first.ok ? { ok: true, command } : { ok: false, command, error: first.error };
  }

  const fallback = { command: "gio", args: ["open", url] };
  const second = await runOpenCommand(fallback);
  return second.ok ? { ok: true, command: fallback } : { ok: false, command: fallback, error: second.error };
}

function runOpenCommand(command: BrowserCommand): Promise<{ ok: true } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    let settled = false;
    let earlyExitTimer: ReturnType<typeof setTimeout> | undefined;

    function finish(result: { ok: true } | { ok: false; error: string }) {
      if (settled) {
        return;
      }

      settled = true;
      if (earlyExitTimer) {
        clearTimeout(earlyExitTimer);
      }
      resolve(result);
    }

    const child = spawn(command.command, command.args, {
      detached: true,
      stdio: "ignore"
    });

    child.once("error", (error) => {
      finish({ ok: false, error: error.message });
    });

    child.once("exit", (code, signal) => {
      if (code === 0) {
        finish({ ok: true });
        return;
      }

      finish({
        ok: false,
        error: `${command.command} exited with ${code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`}.`
      });
    });

    child.once("spawn", () => {
      child.unref();
      earlyExitTimer = setTimeout(() => finish({ ok: true }), EARLY_EXIT_WINDOW_MS);
    });
  });
}
