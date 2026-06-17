import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildFinalOutput, type FinalOutput } from "../shared/answers";
import {
  assertAnswerEnvelope,
  createRemoteSessionPackage,
  decryptAnswerEnvelope,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  parseRemoteSessionReceipt,
  type RemoteSessionReceipt
} from "../shared/cloud-protocol";
import { LoopmarkInputError } from "../shared/errors";
import type { NormalizedSession } from "../shared/schema";
import { validateSubmitPayload } from "../shared/submission";

export type RemoteCreateOptions = {
  baseUrl?: string;
  receiptDir?: string;
  fetch?: typeof fetch;
};

export type RemoteCreateResult = {
  status: "created";
  fillUrl: string;
  receiptFile: string;
  sessionId: string;
};

export type RemoteCollectOptions = {
  secretDir?: string;
  fetch?: typeof fetch;
};

export type RemoteCollectResult =
  | FinalOutput
  | {
      status: "pending";
      message: string;
    };

export async function createRemoteSession(
  session: NormalizedSession,
  options: RemoteCreateOptions = {}
): Promise<RemoteCreateResult> {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL);
  const clientFetch = options.fetch ?? fetch;
  const sessionPackage = await createRemoteSessionPackage({ session, baseUrl });
  const response = await clientFetch(apiUrl(baseUrl, "/api/sessions"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sessionPackage.envelope)
  });

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "Unable to create Loopmark session."));
  }

  const receiptFile = await writeReceipt(sessionPackage.receipt, options.receiptDir);
  return {
    status: "created",
    fillUrl: sessionPackage.fillUrl,
    receiptFile,
    sessionId: sessionPackage.sessionId
  };
}

export async function collectRemoteResult(
  receiptFile: string,
  options: RemoteCollectOptions = {}
): Promise<RemoteCollectResult> {
  const receipt = await readReceipt(receiptFile);
  const clientFetch = options.fetch ?? fetch;
  const response = await clientFetch(apiUrl(receipt.baseUrl, `/api/sessions/${receipt.sessionId}/answer`));

  if (response.status === 202) {
    return {
      status: "pending",
      message: "Loopmark session has not been submitted yet."
    };
  }

  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "Unable to collect Loopmark answer."));
  }

  const rawEnvelope = (await response.json()) as unknown;
  assertAnswerEnvelope(rawEnvelope);
  const payload = await decryptAnswerEnvelope({ receipt, envelope: rawEnvelope });
  const validation = validateSubmitPayload(receipt.session, payload);
  if (!validation.ok) {
    throw new LoopmarkInputError(
      validation.report.errors.map((error) => ({
        path: error.path,
        code: error.code,
        message: error.message,
        why: "The encrypted answer payload did not match the original Loopmark session.",
        fix: "Ask the user to submit the current Loopmark session again, then run collect with the same receipt."
      }))
    );
  }

  const secretDir = options.secretDir ?? join(tmpdir(), `loopmark-${receipt.sessionId}`);
  return buildFinalOutput(receipt.session, validation.payload, { secretDir });
}

async function writeReceipt(receipt: RemoteSessionReceipt, receiptDir?: string): Promise<string> {
  const directory = resolve(receiptDir ?? join(tmpdir(), "loopmark-receipts"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptFile = join(directory, `${receipt.sessionId}.receipt.json`);
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return receiptFile;
}

async function readReceipt(receiptFile: string): Promise<RemoteSessionReceipt> {
  const resolved = resolve(receiptFile);
  const raw = await readFile(resolved, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const receipt = parseRemoteSessionReceipt(parsed);
  return {
    ...receipt,
    baseUrl: normalizeBaseUrl(receipt.baseUrl),
    fillUrl: receipt.fillUrl,
    sessionId: receipt.sessionId
  };
}

function apiUrl(baseUrl: string, path: string): string {
  return new URL(path, normalizeBaseUrl(baseUrl)).toString();
}

async function responseErrorMessage(response: Response, fallback: string): Promise<string> {
  const text = await response.text().catch(() => "");
  if (!text) {
    return `${fallback} HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed) && typeof parsed.error === "string") {
      return parsed.error;
    }
  } catch {
    return text;
  }

  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
