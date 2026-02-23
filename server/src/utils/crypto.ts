import crypto from "crypto";

const ITERATIONS = 100_000;
const KEYLEN = 64;
const DIGEST = "sha512";

export function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST)
    .toString("hex");

  return { hash, salt };
}

// Verify password
export function verifyPassword(
  password: string,
  hash: string,
  salt: string
): boolean {
  const hashVerify = crypto
    .pbkdf2Sync(password, salt, ITERATIONS, KEYLEN, DIGEST)
    .toString("hex");

  return hash === hashVerify;
}

export function verifySignature(
  body: string,
  signature: string,
  appSecret: string
) {
  const hash = crypto
    .createHmac("sha256", appSecret)
    .update(body, "utf-8")
    .digest("hex");

  return `sha256=${hash}` === signature;
}
