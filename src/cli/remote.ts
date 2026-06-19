import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  assertSessionId,
  assertSecretBundleEnvelope,
  createRemoteSessionPackage,
  decryptSecretBundleEnvelope,
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  parseRemoteSessionReceipt,
  type SecretBundle,
  type RemoteSessionReceipt
} from "../shared/cloud-protocol";
import type { NormalizedSession } from "../shared/schema";
import type { NormalizedField } from "../shared/schema";
import { secretEnvKeyForFieldId } from "../shared/secret-env";

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

export type RemoteSecretsOptions = {
  receiptFile?: string;
  receiptDir?: string;
  secretDir?: string;
  fetch?: typeof fetch;
};

export type RemoteSecretsResult = {
  status: "secrets_downloaded";
  sessionId: string;
  secretFile: string;
  format: "env";
  preview: {
    kind: "env_redacted";
    text: string;
  };
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

export async function downloadRemoteSecrets(
  sessionId: string,
  options: RemoteSecretsOptions = {}
): Promise<RemoteSecretsResult> {
  const normalizedSessionId = assertSessionId(sessionId);
  const receipt = await readReceipt(options.receiptFile ?? defaultReceiptFile(normalizedSessionId, options.receiptDir));
  if (receipt.sessionId !== normalizedSessionId) {
    throw new Error("Loopmark receipt does not match the requested session id.");
  }

  const clientFetch = options.fetch ?? fetch;
  const response = await clientFetch(apiUrl(receipt.baseUrl, `/api/sessions/${encodeURIComponent(normalizedSessionId)}/secrets`));
  if (!response.ok) {
    throw new Error(await responseErrorMessage(response, "Unable to download Loopmark secrets."));
  }

  const envelope = (await response.json()) as unknown;
  assertSecretBundleEnvelope(envelope);
  const bundle = await decryptSecretBundleEnvelope({ receipt, envelope });
  const secretDir = resolve(options.secretDir ?? join(tmpdir(), `loopmark-${normalizedSessionId}`));
  const secretFile = join(secretDir, "secrets.env");
  const preview = await writeSecretEnvFile(receipt, bundle, secretFile);

  return {
    status: "secrets_downloaded",
    sessionId: normalizedSessionId,
    secretFile,
    format: "env",
    preview
  };
}

async function writeReceipt(receipt: RemoteSessionReceipt, receiptDir?: string): Promise<string> {
  const directory = resolve(receiptDir ?? join(tmpdir(), "loopmark-receipts"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const receiptFile = join(directory, `${receipt.sessionId}.receipt.json`);
  await writeFile(receiptFile, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return receiptFile;
}

function defaultReceiptFile(sessionId: string, receiptDir?: string): string {
  return join(resolve(receiptDir ?? join(tmpdir(), "loopmark-receipts")), `${sessionId}.receipt.json`);
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
    sessionId: assertSessionId(receipt.sessionId)
  };
}

async function writeSecretEnvFile(
  receipt: RemoteSessionReceipt,
  bundle: SecretBundle,
  secretFile: string
): Promise<RemoteSecretsResult["preview"]> {
  const directory = resolve(secretFile, "..");
  const lines: string[] = [];
  const previewLines: string[] = [];
  const envKeyByFieldId = assertUniqueSecretEnvKeys(receipt.session);

  for (const field of flattenFields(receipt.session)) {
    if (field.type !== "text" || !field.secret) {
      continue;
    }

    const secret = bundle.secrets[field.id];
    if (!secret) {
      continue;
    }

    const key = envKeyByFieldId.get(field.id);
    if (!key) {
      continue;
    }
    lines.push(`${key}=${formatEnvValue(secret.value)}`);
    previewLines.push(`${key}=<redacted>`);
  }

  if (lines.length === 0) {
    throw new Error("Loopmark secret bundle did not contain any declared secret values.");
  }

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(secretFile, `${lines.join("\n")}${lines.length > 0 ? "\n" : ""}`, {
    encoding: "utf8",
    mode: 0o600
  });

  return {
    kind: "env_redacted",
    text: `${previewLines.join("\n")}\n`
  };
}

function assertUniqueSecretEnvKeys(session: NormalizedSession): Map<string, string> {
  const seenKeys = new Map<string, string>();
  const envKeyByFieldId = new Map<string, string>();

  for (const field of flattenFields(session)) {
    if (field.type !== "text" || !field.secret) {
      continue;
    }

    const key = secretEnvKeyForFieldId(field.id);
    const previousFieldId = seenKeys.get(key);
    if (previousFieldId !== undefined) {
      throw new Error(`Loopmark secret fields map to duplicate env key: ${key}.`);
    }

    seenKeys.set(key, field.id);
    envKeyByFieldId.set(field.id, key);
  }

  return envKeyByFieldId;
}

function formatEnvValue(value: string): string {
  if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}

function flattenFields(session: NormalizedSession): NormalizedField[] {
  return session.groups.flatMap((group) => group.fields);
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
