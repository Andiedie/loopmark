import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.fn();

vi.mock("node:child_process", () => ({
  default: { spawn: spawnMock },
  spawn: spawnMock
}));

describe("browser opening", () => {
  beforeEach(() => {
    vi.resetModules();
    spawnMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back on Linux when xdg-open exits immediately with failure", async () => {
    spawnMock.mockImplementation((command: string) => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", command === "xdg-open" ? 1 : 0);
      });

      return child;
    });

    const { openBrowser } = await import("../src/server/open-browser");
    const result = await openBrowser("http://local", "linux");

    expect(result).toEqual({
      ok: true,
      command: { command: "gio", args: ["open", "http://local"] }
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("returns a command error on non-Linux opener failure", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", 1);
      });

      return child;
    });

    const { openBrowser } = await import("../src/server/open-browser");
    const result = await openBrowser("http://local", "darwin");

    expect(result).toEqual({
      ok: false,
      command: { command: "open", args: ["http://local"] },
      error: "open exited with code 1."
    });
  });

  it("returns the fallback error when both Linux openers fail", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", 1);
      });

      return child;
    });

    const { openBrowser } = await import("../src/server/open-browser");
    const result = await openBrowser("http://local", "linux");

    expect(result).toEqual({
      ok: false,
      command: { command: "gio", args: ["open", "http://local"] },
      error: "gio exited with code 1."
    });
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });

  it("reports spawn errors", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("error", new Error("missing opener"));
      });

      return child;
    });

    const { openBrowser } = await import("../src/server/open-browser");
    const result = await openBrowser("http://local", "darwin");

    expect(result).toEqual({
      ok: false,
      command: { command: "open", args: ["http://local"] },
      error: "missing opener"
    });
  });

  it("treats a spawned opener as successful after the early-exit window", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as EventEmitter & { unref: () => void };
    child.unref = vi.fn();
    spawnMock.mockReturnValue(child);

    const { openBrowser } = await import("../src/server/open-browser");
    const resultPromise = openBrowser("http://local", "darwin");
    child.emit("spawn");
    await vi.advanceTimersByTimeAsync(500);

    await expect(resultPromise).resolves.toEqual({
      ok: true,
      command: { command: "open", args: ["http://local"] }
    });
    child.emit("exit", 1);
    expect(child.unref).toHaveBeenCalled();
  });

  it("reports opener signal exits", async () => {
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as EventEmitter & { unref: () => void };
      child.unref = vi.fn();

      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("exit", null, "SIGTERM");
      });

      return child;
    });

    const { openBrowser } = await import("../src/server/open-browser");
    const result = await openBrowser("http://local", "darwin");

    expect(result).toEqual({
      ok: false,
      command: { command: "open", args: ["http://local"] },
      error: "open exited with signal SIGTERM."
    });
  });
});
