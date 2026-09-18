import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dateInZone,
  validDate,
  normalizeDomain,
  micros,
  numberOrNull,
} from "../lib/reporting";
import {
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  sessionToken,
  validSession,
} from "../lib/server/crypto";
import { randomBytes } from "node:crypto";
test("report dates use the account timezone across midnight and DST", () => {
  const now = new Date("2026-03-09T03:30:00Z");
  assert.equal(dateInZone("America/New_York", 0, now), "2026-03-08");
  assert.equal(dateInZone("America/New_York", -1, now), "2026-03-07");
  assert.equal(dateInZone("Asia/Kolkata", 0, now), "2026-03-09");
  assert.equal(
    dateInZone("Asia/Kolkata", -1, new Date("2026-01-01T03:00:00Z")),
    "2025-12-31",
  );
});
test("missing source metrics remain missing, while true zero stays zero", () => {
  assert.equal(micros(undefined), null);
  assert.equal(numberOrNull(""), null);
  assert.equal(micros("0"), 0);
  assert.equal(micros("125050000"), 125.05);
  assert.equal(numberOrNull("2.75"), 2.75);
});
test("dates reject malformed or impossible calendar values", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("2026-09-18"), true);
  assert.equal(validDate("2026-01-01' OR 1=1"), false);
});
test("Shopify credentials cannot be sent to arbitrary hosts", () => {
  assert.equal(
    normalizeDomain("https://my-shop.myshopify.com/"),
    "my-shop.myshopify.com",
  );
  for (const d of [
    "example.com",
    "shop.myshopify.com.evil.com",
    "127.0.0.1",
    "user@shop.myshopify.com",
    "shop.myshopify.com/admin",
    "shop.myshopify.com:443",
  ])
    assert.throws(() => normalizeDomain(d));
});
test("encrypted credentials round-trip and reject tampering", () => {
  process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
  const saved = encrypt({ token: "test-token" });
  assert.deepEqual(decrypt(saved), { token: "test-token" });
  assert.ok(!saved.includes("test-token"));
  const pieces = saved.split(".");
  const payload = Buffer.from(pieces[2], "base64url");
  payload[0] ^= 1;
  pieces[2] = payload.toString("base64url");
  assert.throws(() => decrypt(pieces.join(".")));
});
test("owner passwords and session signatures reject wrong credentials", () => {
  const hash = hashPassword("correct-test-passphrase");
  assert.equal(verifyPassword("incorrect-test-passphrase", hash), false);
  assert.equal(verifyPassword("correct-test-passphrase", hash), true);
  process.env.SESSION_SECRET = randomBytes(32).toString("hex");
  const token = sessionToken();
  assert.equal(validSession(token), true);
  assert.equal(
    validSession(token.replace(/^./, token[0] === "a" ? "b" : "a")),
    false,
  );
  assert.equal(validSession("bad"), false);
});
