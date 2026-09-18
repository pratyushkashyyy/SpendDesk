import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
function key() {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw || !/^[a-f0-9]{64}$/i.test(raw))
    throw new Error("Encryption key is not configured.");
  return Buffer.from(raw, "hex");
}
export function encrypt(value: unknown) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), body]
    .map((b) => b.toString("base64url"))
    .join(".");
}
export function decrypt<T>(value: string): T {
  const [iv, tag, body] = value
    .split(".")
    .map((s) => Buffer.from(s, "base64url"));
  const cipher = createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([cipher.update(body), cipher.final()]).toString("utf8"),
  );
}
export function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(password, salt, 64).toString("hex")}`;
}
export function verifyPassword(password: string, saved: string) {
  const [salt, hash] = saved.split(":");
  return (
    !!salt &&
    !!hash &&
    equal(scryptSync(password, salt, 64).toString("hex"), hash)
  );
}
function sign(payload: string) {
  const key = process.env.SESSION_SECRET;
  if (!key || key.length < 32)
    throw new Error("Session secret is not configured.");
  return createHmac("sha256", key).update(payload).digest("base64url");
}
export function sessionToken() {
  const payload = Buffer.from(
    JSON.stringify({
      exp: Date.now() + 7 * 86400000,
      nonce: randomBytes(16).toString("hex"),
    }),
  ).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function validSession(token?: string) {
  if (!token) return false;
  try {
    const [payload, sig] = token.split(".");
    return (
      equal(sign(payload), sig) &&
      JSON.parse(Buffer.from(payload, "base64url").toString()).exp > Date.now()
    );
  } catch {
    return false;
  }
}
