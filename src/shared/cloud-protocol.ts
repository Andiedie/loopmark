import type { NormalizedSession } from "./schema";

export const DEFAULT_BASE_URL = "https://loopmark.ssoo.fun";
export const SESSION_CODE_PREFIX = "lm1_";
export const PROTOCOL_VERSION = 1;

const SESSION_ID_BYTES = 18;
const SESSION_CODE_BYTES = 32;
const AES_KEY_BITS = 256;
const GCM_IV_BYTES = 12;
const HKDF_SALT_BYTES = 16;
const SESSION_ID_PATTERN = /^s_[A-Za-z0-9_-]{24}$/;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export type SessionEnvelope = {
  version: 1;
  kind: "loopmark.session";
  sessionId: string;
  secretUploadProofHash: string;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type SecretBundle = {
  secrets: Record<string, { value: string }>;
};

export type SecretBundleEnvelope = {
  version: 1;
  kind: "loopmark.secrets";
  sessionId: string;
  ephemeralPublicKey: JsonWebKey;
  salt: string;
  iv: string;
  ciphertext: string;
};

export type SecretBundleSubmission = {
  version: 1;
  kind: "loopmark.secret_submission";
  sessionId: string;
  secretUploadProof: string;
  envelope: SecretBundleEnvelope;
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
  const secretUploadProof = await deriveSecretUploadProof(sessionCode);
  const plaintext: SessionPlaintext = {
    version: PROTOCOL_VERSION,
    session: input.session,
    answerPublicKey,
    createdAt
  };
  const envelope = await encryptSessionEnvelope(
    sessionCode,
    sessionId,
    plaintext,
    await hashSecretUploadProof(secretUploadProof)
  );
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

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function assertSessionId(sessionId: string): string {
  if (!isValidSessionId(sessionId)) {
    throw new Error("Loopmark session id is invalid.");
  }

  return sessionId;
}

export async function deriveSecretUploadProof(sessionCode: string): Promise<string> {
  const normalized = normalizeSessionCode(sessionCode);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(TEXT_ENCODER.encode(`loopmark-v1-secret-upload-proof:${normalized}`))
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export async function hashSecretUploadProof(secretUploadProof: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(TEXT_ENCODER.encode(`loopmark-v1-secret-upload-proof-hash:${secretUploadProof}`))
  );
  return base64UrlEncode(new Uint8Array(digest));
}

export async function verifySecretUploadProof(input: {
  secretUploadProof: string;
  secretUploadProofHash: string;
}): Promise<boolean> {
  return timingSafeStringEquals(
    await hashSecretUploadProof(input.secretUploadProof),
    input.secretUploadProofHash
  );
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

export async function encryptSecretBundleEnvelope(input: {
  sessionId: string;
  answerPublicKey: JsonWebKey;
  bundle: SecretBundle;
}): Promise<SecretBundleEnvelope> {
  const sessionId = assertSessionId(input.sessionId);
  if (!isP256PublicJwk(input.answerPublicKey)) {
    throw new Error("Loopmark answer public key is invalid.");
  }

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
  const key = await deriveAesKey(new Uint8Array(sharedSecret), salt, "loopmark-v1-secrets");
  const encrypted = await encryptJson(key, input.bundle);
  const ephemeralPublicKey = await crypto.subtle.exportKey("jwk", ephemeralKeys.publicKey);

  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.secrets",
    sessionId,
    ephemeralPublicKey,
    salt: base64UrlEncode(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  };
}

export async function createSecretBundleSubmission(input: {
  sessionCode: string;
  sessionId: string;
  envelope: SecretBundleEnvelope;
}): Promise<SecretBundleSubmission> {
  const sessionId = assertSessionId(input.sessionId);
  assertSecretBundleEnvelope(input.envelope);
  if (input.envelope.sessionId !== sessionId) {
    throw new Error("Secret submission session id does not match its envelope.");
  }

  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.secret_submission",
    sessionId,
    secretUploadProof: await deriveSecretUploadProof(input.sessionCode),
    envelope: input.envelope
  };
}

export async function decryptSecretBundleEnvelope(input: {
  receipt: RemoteSessionReceipt;
  envelope: SecretBundleEnvelope;
}): Promise<SecretBundle> {
  const receipt = parseRemoteSessionReceipt(input.receipt);
  assertSecretBundleEnvelope(input.envelope);
  if (input.envelope.sessionId !== receipt.sessionId) {
    throw new Error("Secret bundle envelope does not belong to this receipt.");
  }

  const privateKey = await crypto.subtle.importKey(
    "jwk",
    receipt.answerPrivateKey,
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
    "loopmark-v1-secrets"
  );
  const plaintext = await decryptJson(key, input.envelope.iv, input.envelope.ciphertext);
  return parseSecretBundle(plaintext);
}

export function assertSessionEnvelope(value: unknown): asserts value is SessionEnvelope {
  if (!isRecord(value)) {
    throw new Error("Session envelope must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.session" ||
    typeof value.sessionId !== "string" ||
    !isValidSessionId(value.sessionId) ||
    typeof value.secretUploadProofHash !== "string" ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string"
  ) {
    throw new Error("Session envelope is invalid.");
  }
}

export function assertSecretBundleEnvelope(value: unknown): asserts value is SecretBundleEnvelope {
  if (!isRecord(value)) {
    throw new Error("Secret bundle envelope must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.secrets" ||
    typeof value.sessionId !== "string" ||
    !isValidSessionId(value.sessionId) ||
    typeof value.salt !== "string" ||
    typeof value.iv !== "string" ||
    typeof value.ciphertext !== "string" ||
    !isP256PublicJwk(value.ephemeralPublicKey)
  ) {
    throw new Error("Secret bundle envelope is invalid.");
  }
}

export function assertSecretBundleSubmission(value: unknown): asserts value is SecretBundleSubmission {
  if (!isRecord(value)) {
    throw new Error("Secret submission must be an object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    value.kind !== "loopmark.secret_submission" ||
    typeof value.sessionId !== "string" ||
    typeof value.secretUploadProof !== "string"
  ) {
    throw new Error("Secret submission is invalid.");
  }

  assertSecretBundleEnvelope(value.envelope);
  if (value.envelope.sessionId !== value.sessionId) {
    throw new Error("Secret submission session id does not match its envelope.");
  }
}

export function parseRemoteSessionReceipt(value: unknown): RemoteSessionReceipt {
  if (!isRecord(value)) {
    throw new Error("Loopmark receipt must be a JSON object.");
  }
  if (
    value.version !== PROTOCOL_VERSION ||
    !isUrlString(value.baseUrl) ||
    !isUrlString(value.fillUrl) ||
    typeof value.sessionId !== "string" ||
    !isValidSessionId(value.sessionId) ||
    typeof value.createdAt !== "string" ||
    !isNormalizedSession(value.session) ||
    !isP256PrivateJwk(value.answerPrivateKey)
  ) {
    throw new Error("Loopmark receipt is invalid.");
  }

  return value as RemoteSessionReceipt;
}

async function encryptSessionEnvelope(
  sessionCode: string,
  sessionId: string,
  plaintext: SessionPlaintext,
  secretUploadProofHash: string
): Promise<SessionEnvelope> {
  const salt = randomBytes(HKDF_SALT_BYTES);
  const key = await deriveQuestionKey(sessionCode, salt);
  const encrypted = await encryptJson(key, plaintext);
  return {
    version: PROTOCOL_VERSION,
    kind: "loopmark.session",
    sessionId,
    secretUploadProofHash,
    salt: base64UrlEncode(salt),
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  };
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
  if (
    !isRecord(value) ||
    value.version !== PROTOCOL_VERSION ||
    !isNormalizedSession(value.session) ||
    !isP256PublicJwk(value.answerPublicKey)
  ) {
    throw new Error("Decrypted Loopmark session is invalid.");
  }
  return value as SessionPlaintext;
}

function parseSecretBundle(value: unknown): SecretBundle {
  if (!isRecord(value) || !isRecord(value.secrets)) {
    throw new Error("Decrypted Loopmark secret bundle is invalid.");
  }

  const secrets: SecretBundle["secrets"] = Object.create(null) as SecretBundle["secrets"];
  for (const [fieldId, secret] of Object.entries(value.secrets)) {
    if (!isRecord(secret) || typeof secret.value !== "string") {
      throw new Error("Decrypted Loopmark secret bundle is invalid.");
    }

    secrets[fieldId] = { value: secret.value };
  }

  return { secrets };
}

function isNormalizedSession(value: unknown): value is NormalizedSession {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    isOptionalString(value.description) &&
    Array.isArray(value.groups) &&
    value.groups.length > 0 &&
    value.groups.every(isNormalizedGroup)
  );
}

function isNormalizedGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.title === "string" &&
    isOptionalString(value.description) &&
    Array.isArray(value.fields) &&
    value.fields.length > 0 &&
    value.fields.every(isNormalizedField)
  );
}

function isNormalizedField(value: unknown): boolean {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.label !== "string" ||
    !isOptionalString(value.description)
  ) {
    return false;
  }

  if (value.type === "text") {
    return (
      typeof value.multiline === "boolean" &&
      typeof value.secret === "boolean" &&
      isOptionalString(value.default)
    );
  }

  if (value.type === "choice") {
    return (
      isChoiceMode(value.mode) &&
      Array.isArray(value.options) &&
      value.options.length > 0 &&
      value.options.every(isNormalizedChoiceItem) &&
      Array.isArray(value.defaultItems) &&
      value.defaultItems.every(isNormalizedChoiceItem)
    );
  }

  return false;
}

function isNormalizedChoiceItem(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    isOptionalString(value.description)
  );
}

function isP256PrivateJwk(value: unknown): boolean {
  return (
    hasP256JwkCoordinates(value) &&
    typeof value.d === "string"
  );
}

function isP256PublicJwk(value: unknown): boolean {
  return (
    hasP256JwkCoordinates(value) &&
    value.d === undefined
  );
}

function hasP256JwkCoordinates(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value.kty === "EC" &&
    value.crv === "P-256" &&
    typeof value.x === "string" &&
    typeof value.y === "string"
  );
}

function isUrlString(value: unknown): boolean {
  if (typeof value !== "string") {
    return false;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

function isChoiceMode(value: unknown): boolean {
  return value === "single" || value === "multiple" || value === "ranking";
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function timingSafeStringEquals(left: string, right: string): boolean {
  const leftBytes = TEXT_ENCODER.encode(left);
  const rightBytes = TEXT_ENCODER.encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return diff === 0;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
