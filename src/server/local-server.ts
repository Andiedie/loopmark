import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import worker, { type WorkerEnv } from "./worker";

class MemoryR2Object {
  constructor(private readonly value: string) {}

  async text(): Promise<string> {
    return this.value;
  }
}

class MemoryR2Bucket {
  private readonly objects = new Map<string, string>();

  async get(key: string): Promise<MemoryR2Object | null> {
    const value = this.objects.get(key);
    return value === undefined ? null : new MemoryR2Object(value);
  }

  async put(
    key: string,
    value: string,
    options?: Parameters<WorkerEnv["LOOPMARK_SESSIONS"]["put"]>[2]
  ): Promise<unknown | null> {
    if (options?.onlyIf?.etagDoesNotMatch === "*" && this.objects.has(key)) {
      return null;
    }

    this.objects.set(key, value);
    return { key };
  }
}

export type RunningLoopmarkServer = {
  url: string;
  close: () => Promise<void>;
};

export async function startLocalLoopmarkServer(webRoot: string): Promise<RunningLoopmarkServer> {
  const env: WorkerEnv = {
    LOOPMARK_SESSIONS: new MemoryR2Bucket(),
    ASSETS: createAssetsBinding(resolve(webRoot))
  };
  const server = createServer((request, response) => {
    void handleNodeRequest(request, response, env);
  });

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const onError = (error: Error) => {
      rejectPromise(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      resolvePromise();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine local Loopmark server address.");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => {
          if (error) {
            rejectPromise(error);
            return;
          }
          resolvePromise();
        });
      })
  };
}

async function handleNodeRequest(
  incoming: IncomingMessage,
  outgoing: ServerResponse,
  env: WorkerEnv
): Promise<void> {
  try {
    const request = await toFetchRequest(incoming);
    const response = await worker.fetch(request, env);
    await writeFetchResponse(outgoing, response);
  } catch (error) {
    outgoing.statusCode = 500;
    outgoing.setHeader("content-type", "text/plain; charset=utf-8");
    outgoing.end(error instanceof Error ? error.message : "Unexpected local Loopmark server error.");
  }
}

async function toFetchRequest(incoming: IncomingMessage): Promise<Request> {
  const headers = new Headers();
  for (const [key, value] of Object.entries(incoming.headers)) {
    if (value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
      continue;
    }

    headers.set(key, value);
  }

  const host = headers.get("host") ?? "127.0.0.1";
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  return new Request(`http://${host}${incoming.url ?? "/"}`, {
    method: incoming.method,
    headers,
    body: chunks.length > 0 ? Buffer.concat(chunks) : undefined
  });
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, key) => {
    outgoing.setHeader(key, value);
  });

  if (!response.body) {
    outgoing.end();
    return;
  }

  outgoing.end(Buffer.from(await response.arrayBuffer()));
}

function createAssetsBinding(webRoot: string): WorkerEnv["ASSETS"] {
  return {
    fetch: async (request) => {
      const url = new URL(request.url);
      const file = safeAssetPath(webRoot, url.pathname);
      if (!file) {
        return new Response("Not found", { status: 404 });
      }

      try {
        const body = await readFile(file);
        return new Response(body, {
          headers: { "content-type": contentType(file) }
        });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    }
  };
}

function safeAssetPath(webRoot: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relative = decoded === "/" || decoded === "/s" ? "index.html" : decoded.replace(/^\/+/, "");
  const file = resolve(webRoot, relative);
  if (file !== webRoot && !file.startsWith(`${webRoot}${sep}`)) {
    return null;
  }
  return file;
}

function contentType(file: string): string {
  switch (extname(file)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
    case ".mjs":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".ico":
      return "image/x-icon";
    case ".webmanifest":
      return "application/manifest+json; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}
