import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { runCli, type CliDependencies, type CliRuntime } from "../src/cli/run";
import { parseInputJson } from "../src/shared/schema";
import type { FinalOutput } from "../src/shared/answers";

function createRuntime(input: string, overrides: Partial<Pick<CliRuntime, "argv" | "env">> = {}) {
  let stdout = "";
  let stderr = "";
  const runtime: CliRuntime = {
    argv: overrides.argv ?? ["node", "loopmark"],
    env: overrides.env ?? { LOOPMARK_NO_OPEN: "1" },
    stdin: Readable.from([input]),
    stdout: {
      write: vi.fn((chunk: string | Uint8Array) => {
        stdout += chunk.toString();
        return true;
      })
    },
    stderr: {
      write: vi.fn((chunk: string | Uint8Array) => {
        stderr += chunk.toString();
        return true;
      })
    }
  };

  return {
    runtime,
    stdout: () => stdout,
    stderr: () => stderr
  };
}

function createDependencies(output: FinalOutput = { status: "submitted", answers: {} }) {
  const close = vi.fn(async () => undefined);
  const dependencies: CliDependencies = {
    parseInputJson,
    startLoopmarkServer: vi.fn(async () => ({
      url: "http://127.0.0.1:12345/s/test-token",
      token: "test-token",
      port: 12345,
      result: Promise.resolve(output),
      close
    })),
    openBrowser: vi.fn(async () => ({
      ok: true as const,
      command: { command: "open", args: ["http://127.0.0.1:12345/s/test-token"] }
    }))
  };

  return { dependencies, close };
}

describe("CLI runner", () => {
  it("prints help without reading or starting a session", async () => {
    const { runtime, stdout, stderr } = createRuntime("", { argv: ["node", "loopmark", "--help"] });
    const { dependencies } = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(stdout()).toContain("Usage: cat questions.json | loopmark");
    expect(stderr()).toBe("");
    expect(dependencies.startLoopmarkServer).not.toHaveBeenCalled();
  });

  it("prints agent-readable validation errors to stderr only", async () => {
    const { runtime, stdout, stderr } = createRuntime("{bad");
    const { dependencies } = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(1);
    expect(stdout()).toBe("");
    expect(JSON.parse(stderr())).toMatchObject({
      status: "invalid_input",
      errors: [{ path: "$", code: "invalid_json" }]
    });
    expect(dependencies.startLoopmarkServer).not.toHaveBeenCalled();
  });

  it("writes only the final answer JSON to stdout on success", async () => {
    const output: FinalOutput = {
      status: "submitted",
      answers: {
        scope: {
          question: "Scope",
          answer: "Ship the clean implementation."
        }
      }
    };
    const { runtime, stdout, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      })
    );
    const { dependencies, close } = createDependencies(output);

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(JSON.parse(stdout())).toEqual(output);
    expect(stderr()).toBe("Loopmark URL: http://127.0.0.1:12345/s/test-token\n");
    expect(dependencies.openBrowser).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("prints the manual URL when browser opening fails", async () => {
    const { runtime, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      }),
      { env: {} }
    );
    const { dependencies } = createDependencies();
    dependencies.openBrowser = vi.fn(async () => ({ ok: false as const, error: "no opener available" }));

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(stderr()).toContain("Could not open browser automatically: no opener available");
    expect(stderr()).toContain("Open this URL manually: http://127.0.0.1:12345/s/test-token");
  });

  it("opens the browser when no skip flag is set", async () => {
    const { runtime, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      }),
      { env: {} }
    );
    const { dependencies } = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(dependencies.openBrowser).toHaveBeenCalledWith("http://127.0.0.1:12345/s/test-token");
    expect(stderr()).not.toContain("Could not open browser automatically");
  });

  it("prints unexpected runtime errors as structured stderr JSON", async () => {
    const { runtime, stdout, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      })
    );
    const { dependencies } = createDependencies();
    dependencies.startLoopmarkServer = vi.fn(async () => {
      throw new Error("port unavailable");
    });

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(1);
    expect(stdout()).toBe("");
    expect(JSON.parse(stderr())).toEqual({
      status: "error",
      message: "port unavailable"
    });
  });

  it("handles non-Error runtime failures without leaking stack details", async () => {
    const { runtime, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      })
    );
    const { dependencies } = createDependencies();
    dependencies.startLoopmarkServer = vi.fn(async () => {
      throw "boom";
    });

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(1);
    expect(JSON.parse(stderr())).toEqual({
      status: "error",
      message: "Unexpected Loopmark error."
    });
  });
});
