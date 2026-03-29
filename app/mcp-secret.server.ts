import { requireEnv } from "./env.server";

function generateRandomToken(bytes = 32) {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return Array.from(values)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function createMcpSecret() {
  return generateRandomToken(24);
}

export async function hashMcpSecret(secret: string) {
  return sha256Hex(secret);
}

export async function verifyMcpSecret(secret: string, expectedHash: string | null | undefined) {
  if (!expectedHash) {
    return false;
  }

  return (await hashMcpSecret(secret)) === expectedHash;
}

export async function hashIdentifier(value: string) {
  return sha256Hex(value);
}

function decodeHex(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new Error("MCP_SECRET_ENCRYPTION_KEY must be a 64-character hex string.");
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }

  return bytes;
}

function encodeBase64(bytes: Uint8Array) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }

  return btoa(binary);
}

function decodeBase64(value: string) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function importEncryptionKey() {
  const rawKey = decodeHex(requireEnv("MCP_SECRET_ENCRYPTION_KEY"));
  return crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptMcpSecret(secret: string) {
  const key = await importEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(secret);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
      },
      key,
      payload,
    ),
  );

  return `v1:${encodeBase64(iv)}:${encodeBase64(ciphertext)}`;
}

export async function decryptMcpSecret(secretCiphertext: string) {
  const [version, ivValue, ciphertextValue] = secretCiphertext.split(":");
  if (version !== "v1" || !ivValue || !ciphertextValue) {
    throw new Error("Invalid MCP secret ciphertext payload.");
  }

  const key = await importEncryptionKey();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decodeBase64(ivValue),
    },
    key,
    decodeBase64(ciphertextValue),
  );

  return new TextDecoder().decode(plaintext);
}
