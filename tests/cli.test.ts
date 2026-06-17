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
    env: overrides.env ?? {},
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

function createDependencies(output: FinalOutput = { status: "submitted", answers: {} }): CliDependencies {
  return {
    parseInputJson,
    createRemoteSession: vi.fn(async () => ({
      status: "created" as const,
      fillUrl: "https://loopmark.example/s#lm1_test",
      receiptFile: "/tmp/loopmark-receipts/s_test.receipt.json",
      sessionId: "s_test"
    })),
    collectRemoteResult: vi.fn(async () => output)
  };
}

describe("CLI runner", () => {
  it("prints help without reading or creating a session", async () => {
    const { runtime, stdout, stderr } = createRuntime("", { argv: ["node", "loopmark", "--help"] });
    const dependencies = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(stdout()).toContain("loopmark [--base-url URL]");
    expect(stdout()).toContain("loopmark collect <receipt-file>");
    expect(stderr()).toBe("");
    expect(dependencies.createRemoteSession).not.toHaveBeenCalled();
    expect(dependencies.collectRemoteResult).not.toHaveBeenCalled();
  });

  it("prints invalid argument errors as structured stderr JSON", async () => {
    const cases = [
      {
        args: ["--base-url"],
        message: "Option --base-url requires a value."
      },
      {
        args: ["--no-open"],
        message: "Unknown Loopmark option: --no-open"
      },
      {
        args: ["collect"],
        message: "Usage: loopmark collect <receipt-file> [--secret-dir DIR]"
      },
      {
        args: ["collect", "/tmp/receipt.json", "--base-url", "https://loopmark.example"],
        message: "Unknown Loopmark option: --base-url"
      }
    ];

    for (const testCase of cases) {
      const { runtime, stdout, stderr } = createRuntime("", {
        argv: ["node", "loopmark", ...testCase.args]
      });
      const dependencies = createDependencies();

      const code = await runCli(runtime, dependencies);

      expect(code).toBe(1);
      expect(stdout()).toBe("");
      expect(JSON.parse(stderr())).toEqual({
        status: "error",
        message: testCase.message
      });
      expect(dependencies.createRemoteSession).not.toHaveBeenCalled();
      expect(dependencies.collectRemoteResult).not.toHaveBeenCalled();
    }
  });

  it("prints agent-readable validation errors to stderr only", async () => {
    const { runtime, stdout, stderr } = createRuntime("{bad");
    const dependencies = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(1);
    expect(stdout()).toBe("");
    expect(JSON.parse(stderr())).toMatchObject({
      status: "invalid_input",
      errors: [{ path: "$", code: "invalid_json" }]
    });
    expect(dependencies.createRemoteSession).not.toHaveBeenCalled();
  });

  it("creates a remote session and exits without waiting for answers", async () => {
    const { runtime, stdout, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      }),
      {
        argv: ["node", "loopmark", "--base-url", "https://loopmark.example", "--receipt-dir", "/tmp/receipts"]
      }
    );
    const dependencies = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(JSON.parse(stdout())).toEqual({
      status: "created",
      fillUrl: "https://loopmark.example/s#lm1_test",
      receiptFile: "/tmp/loopmark-receipts/s_test.receipt.json",
      sessionId: "s_test"
    });
    expect(stderr()).toContain("Loopmark URL: https://loopmark.example/s#lm1_test");
    expect(stderr()).toContain("Loopmark receipt: /tmp/loopmark-receipts/s_test.receipt.json");
    expect(dependencies.createRemoteSession).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Need input" }),
      {
        baseUrl: "https://loopmark.example",
        receiptDir: "/tmp/receipts"
      }
    );
  });

  it("uses environment defaults for remote session creation", async () => {
    const { runtime } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      }),
      {
        env: {
          LOOPMARK_BASE_URL: "https://env.loopmark.example",
          LOOPMARK_RECEIPT_DIR: "/tmp/env-receipts"
        }
      }
    );
    const dependencies = createDependencies();

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(dependencies.createRemoteSession).toHaveBeenCalledWith(expect.anything(), {
      baseUrl: "https://env.loopmark.example",
      receiptDir: "/tmp/env-receipts"
    });
  });

  it("collects a submitted remote answer from a receipt", async () => {
    const output: FinalOutput = {
      status: "submitted",
      answers: {
        scope: {
          question: "Scope",
          answer: "Ship the clean implementation."
        }
      }
    };
    const { runtime, stdout, stderr } = createRuntime("", {
      argv: ["node", "loopmark", "collect", "/tmp/receipt.json", "--secret-dir", "/tmp/secrets"]
    });
    const dependencies = createDependencies(output);

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(JSON.parse(stdout())).toEqual(output);
    expect(stderr()).toBe("");
    expect(dependencies.collectRemoteResult).toHaveBeenCalledWith("/tmp/receipt.json", {
      secretDir: "/tmp/secrets"
    });
  });

  it("prints pending collection state without failing", async () => {
    const { runtime, stdout, stderr } = createRuntime("", {
      argv: ["node", "loopmark", "collect", "/tmp/receipt.json"]
    });
    const dependencies = createDependencies();
    dependencies.collectRemoteResult = vi.fn(async () => ({
      status: "pending" as const,
      message: "Loopmark session has not been submitted yet."
    }));

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(0);
    expect(JSON.parse(stdout())).toEqual({
      status: "pending",
      message: "Loopmark session has not been submitted yet."
    });
    expect(stderr()).toBe("Loopmark session has not been submitted yet.\n");
  });

  it("prints unexpected runtime errors as structured stderr JSON", async () => {
    const { runtime, stdout, stderr } = createRuntime(
      JSON.stringify({
        title: "Need input",
        fields: [{ id: "scope", label: "Scope", type: "text" }]
      })
    );
    const dependencies = createDependencies();
    dependencies.createRemoteSession = vi.fn(async () => {
      throw new Error("remote unavailable");
    });

    const code = await runCli(runtime, dependencies);

    expect(code).toBe(1);
    expect(stdout()).toBe("");
    expect(JSON.parse(stderr())).toEqual({
      status: "error",
      message: "remote unavailable"
    });
  });
});
