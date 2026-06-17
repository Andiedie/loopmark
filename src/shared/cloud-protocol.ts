import type { SubmitPayload } from "./answer-state";
import type { NormalizedSession } from "./schema";

export const DEFAULT_BASE_URL = "https://loopmark.ssoo.fun";
export const SESSION_CODE_PREFIX = "lm1_";
export const PROTOCOL_VERSION = 1;

const SESSION_ID_BYTES = 18;
const SESSION_CODE_BYTES = 32;
const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;
const HKDF_SALT_BYTES = 16;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type SessionEnvelope = {
  version: 1;
  kind: "loopmark.session";
  sessionId: string;
  answerProofHash: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type AnswerEnvelope = {
  version: 1;
  kind: "loopmark.answer";
  sessionId: string;
  ephemeralPublicKey: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type AnswerSubmissionEnvelope = {
  version: 1;
  kind: "loopmark.answer_submission";
  answerProof: string;
  envelope: AnswerEnvelope;
};

export type SessionPlaintext = {
  version: 1;
  session: NormalizedSession;
  answerPublicKey: JsonWebKey;
  createdAt: string;
};

export type RemoteSessionReceipt = {
  version: 1;
  baseUrl: string;
  fillUrl: string;
  sessionId: string;
  createdAt: string;
  session: NormalizedSession;
  answerPrivateKey: JsonWebKey;
};

export type RemoteSessionPackage = {
  sessionCode: string;
  sessionId: string;
  fillUrl: string;
  envelope: SessionEnvelope;
  receipt: RemoteSessionReceipt;
};

export async function createRemoteSessionPackage(input: {
  session: NormalizedSession;
  baseUrl: string;
  now?: Date;
}): Promise<RemoteSessionPackage> {
  const sessionCode = createSessionCode();
  const sessionId = await deriveSessionId(sessionCode);
  const answerKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const answerPublicKey = await crypto.subtle.exportKey("jwk", answerKeys.publicKey);
  const answerPrivateKey = await crypto.subtle.exportKey("jwk", answerKeys.privateKey);
  const createdAt = (input.now ?? new Date()).toISOString();
  const plaintext: SessionPlaintext = {
    version: PROTOCOL_VERSION,
    session: input.session,
    answerPublicKey,
    createdAt
  };
  const envelope = await encryptSessionEnvelope(sessionCode, sessionId, plaintext);
  const fillUrl = buildFillUrl(input.baseUrl, sessionCode);
  const receipt: RemoteSessionReceipt = {
    version: PROTOCOL_VERSION,
    baseUrl: normalizeBaseUrl(input.baseUrl),
    fillUrl,
    sessionId,
    createdAt,
    session: input.session,
    answerPrivateKey
  };

  return {
    sessionCode,
    sessionId,
    fillUrl,
    envelope,
    receipt
  };
}

export function createSessionCode(): string {
  return `${SESSION_CODE_PREFIX}${base64UrlEncode(randomBytes(SESSION_CODE_BYTES))}`;
}

export async function deriveSessionId(sessionCode: string): Promise<string> {
  const normalized = normalizeSessionCode(sessionCode);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(TEXT_ENCODER.encode(`loopmark-v1-session-id:${normalized}`))
  );
  return `s_${base64UrlEncode(new Uint8Array(digest).slice(0, SESSION_ID_BYTES))}`;
}

export async function createAnswerSubmission(input: {
  sessionCode: string;
  envelope: AnswerEnvelope;
}): Promise<AnswerSubmissionEnvelope> {
  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.answer_submission",
    answerProof: await deriveAnswerProof(input.sessionCode),
    envelope: input.envelope
  };
}

export async function verifyAnswerProof(answerProof: string, answerProofHash: string): Promise<boolean> {
  const expected = await hashAnswerProof(answerProof);
  return constantTimeStringEqual(expected, answerProofHash);
}

export function buildFillUrl(baseUrl: string, sessionCode: string): string {
  const url = new URL("/s", normalizeBaseUrl(baseUrl));
  url.hash = normalizeSessionCode(sessionCode);
  return url.toString();
}

export function normalizeBaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.hash = "";
  url.search = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname) {
    url.pathname = "/";
  }
  return url.toString().replace(/\/$/, "");
}

export function extractSessionCodeFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) {
    return null;
  }

  try {
    return normalizeSessionCode(decodeURIComponent(raw));
  } catch {
    return null;
  }
}

export function normalizeSessionCode(sessionCode: string): string {
  const trimmed = sessionCode.trim();
  if (!trimmed.startsWith(SESSION_CODE_PREFIX)) {
    throw new Error("Loopmark link is missing a valid session code.");
  }

  const encoded = trimmed.slice(SESSION_CODE_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(encoded)) {
    throw new Error("Loopmark session code contains invalid characters.");
  }

  const bytes = base64UrlDecode(encoded);
  if (bytes.byteLength !== SESSION_CODE_BYTES) {
    throw new Error("Loopmark session code has an invalid length.");
  }

  return `${SESSION_CODE_PREFIX}${base64UrlEncode(bytes)}`;
}

export async function decryptSessionEnvelope(
  sessionCode: string,
  envelope: SessionEnvelope
): Promise<SessionPlaintext> {
  assertSessionEnvelope(envelope);
  const key = await deriveQuestionKey(sessionCode, base64UrlDecode(envelope.salt));
  const plaintext = await decryptJson(key, envelope.iv, envelope.ciphertext);
  return parseSessionPlaintext(plaintext);
}

export async function encryptAnswerEnvelope(input: {
  sessionId: string;
  answerPublicKey: JsonWebKey;
  payload: SubmitPayload;
}): Promise<AnswerEnvelope> {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    input.answerPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const ephemeralKeys = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const salt = randomBytes(HKDF_SALT_BYTES);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    ephemeralKeys.privateKey,
    AES_KEY_BITS
  );
  const key = await deriveAesKey(new Uint8Array(sharedSecret), salt, "loopmark-v1-answer");
  const encrypted = await encryptJson(key, input.payload);
  const ephemeralPublicKey = await crypto.subtle.exportKey("jwk", ephemeralKeys.publicKey);

  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.answer",
    sessionId: input.sessionId,
    ephemeralPublicKey,
    salt: base64UrlEncode(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  };
}

export async function decryptAnswerEnvelope(input: {
  receipt: RemoteSessionReceipt;
  envelope: AnswerEnvelope;
}): Promise<SubmitPayload> {
  assertAnswerEnvelope(input.envelope);
  if (input.envelope.sessionId !== input.receipt.sessionId) {
    throw new Error("Answer envelope does not belong to this receipt.");
  }

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    input.receipt.answerPrivateKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveBits"]
  );
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    input.envelope.ephemeralPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    AES_KEY_BITS
  );
  const key = await deriveAesKey(
    new Uint8Array(sharedSecret),
    base64UrlDecode(input.envelope.salt),
    "loopmark-v1-answer"
  );
  const plaintext = await decryptJson(key, input.envelope.iv, input.envelope.ciphertext);
  return parseSubmitPayload(plaintext);
}

export function assertSessionEnvelope(value: unknown): asserts value is SessionEnvelope {
  if (!isRecord(value)) {
    throw new Error("Session envelope must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.session" ||
    typeof value.sessionId !== "string" ||
    typeof value.answerProofHash !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Session envelope is invalid.");
  }
}

export function assertAnswerEnvelope(value: unknown): asserts value is AnswerEnvelope {
  if (!isRecord(value)) {
    throw new Error("Answer envelope must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.answer" ||
    typeof value.sessionId !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string" ||
    !isRecord(value.ephemeralPublicKey)
  ) {
    throw new Error("Answer envelope is invalid.");
  }
}

export function assertAnswerSubmissionEnvelope(value: unknown): asserts value is AnswerSubmissionEnvelope {
  if (!isRecord(value)) {
    throw new Error("Answer submission must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.answer_submission" ||
    typeof value.answerProof !== "string"
  ) {
    throw new Error("Answer submission is invalid.");
  }
  assertAnswerEnvelope(value.envelope);
}

export function parseRemoteSessionReceipt(value: unknown): RemoteSessionReceipt {
  if (!isRecord(value)) {
    throw new Error("Loopmark receipt must be a JSON object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    typeof value.baseUrl !== "string" ||
    typeof value.fillUrl !== "string" ||
    typeof value.sessionId !== "string" ||
    typeof value.createdAt !== "string" ||
    !isRecord(value.session) ||
    !isRecord(value.answerPrivateKey)
  ) {
    throw new Error("Loopmark receipt is invalid.");
  }

  return value as RemoteSessionReceipt;
}

async function encryptSessionEnvelope(
  sessionCode: string,
  sessionId: string,
  plaintext: SessionPlaintext
): Promise<SessionEnvelope> {
  const salt = randomBytes(HKDF_SALT_BYTES);
  const key = await deriveQuestionKey(sessionCode, salt);
  const encrypted = await encryptJson(key, plaintext);
  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.session",
    sessionId,
    answerProofHash: await hashAnswerProof(await deriveAnswerProof(sessionCode)),
    salt: base64UrlEncode(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  };
}

async function deriveAnswerProof(sessionCode: string): Promise<string> {
  const normalized = normalizeSessionCode(sessionCode);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(TEXT_ENCODER.encode(`loopmark-v1-answer-proof:${normalized}`))
  );
  return base64UrlEncode(new Uint8Array(digest));
}

async function hashAnswerProof(answerProof: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(TEXT_ENCODER.encode(`loopmark-v1-answer-proof-hash:${answerProof}`))
  );
  return base64UrlEncode(new Uint8Array(digest));
}

async function deriveQuestionKey(sessionCode: string, salt: Uint8Array): Promise<CryptoKey> {
  const normalized = normalizeSessionCode(sessionCode);
  return deriveAesKey(TEXT_ENCODER.encode(normalized), salt, "loopmark-v1-question");
}

async function deriveAesKey(
  keyMaterialBytes: Uint8Array,
  salt: Uint8Array,
  info: string
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey("raw", toArrayBuffer(keyMaterialBytes), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(salt),
      info: toArrayBuffer(TEXT_ENCODER.encode(info))
    },
    keyMaterial,
    { name: "AES-GCM", length: AES_KEY_BITS },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<{ iv: string; ciphertext: string }> {
  const iv = randomBytes(GCM_IV_BYTES);
  const plaintext = TEXT_ENCODER.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext)
  );
  return {
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(new Uint8Array(ciphertext))
  };
}

async function decryptJson(key: CryptoKey, iv: string, ciphertext: string): Promise<unknown> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlDecode(iv)) },
    key,
    toArrayBuffer(base64UrlDecode(ciphertext))
  );
  return JSON.parse(TEXT_DECODER.decode(decrypted)) as unknown;
}

function parseSessionPlaintext(value: unknown): SessionPlaintext {
  if (!isRecord(value) || value.version !== PROTOCOL_VERSION || !isRecord(value.session) || !isRecord(value.answerPublicKey)) {
    throw new Error("Decrypted Loopmark session is invalid.");
  }
  return value as SessionPlaintext;
}

function parseSubmitPayload(value: unknown): SubmitPayload {
  if (!isRecord(value) || !isRecord(value.answers)) {
    throw new Error("Decrypted Loopmark answer is invalid.");
  }
  return value as SubmitPayload;
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftBytes = TEXT_ENCODER.encode(left);
  const rightBytes = TEXT_ENCODER.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
