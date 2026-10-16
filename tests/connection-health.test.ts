import test from "node:test";
import assert from "node:assert/strict";
import { UpstreamError } from "../lib/server/http";
import {
  googleAuthFailure,
  shopAuthFailure,
} from "../lib/server/connection-health";
import { resolvedHealth } from "../lib/connection-health";
test("Google revoked grants need reconnecting, while OAuth app and query errors need attention", () => {
  assert.equal(
    googleAuthFailure(new UpstreamError(400, "invalid_grant")).status,
    "reauthorization_required",
  );
  assert.equal(
    googleAuthFailure(new UpstreamError(401, "invalid_client")).status,
    "attention",
  );
  assert.equal(googleAuthFailure(new UpstreamError(400)).status, "attention");
  assert.equal(
    googleAuthFailure(new Error("Provider unavailable")).status,
    "attention",
  );
});
test("Shopify rejected tokens need reauthorization; missing scopes and provider failures remain distinct", () => {
  assert.equal(
    shopAuthFailure(new UpstreamError(401)).status,
    "reauthorization_required",
  );
  assert.equal(
    shopAuthFailure(new UpstreamError(400, "invalid_client")).status,
    "reauthorization_required",
  );
  assert.equal(shopAuthFailure(new UpstreamError(403)).status, "attention");
  assert.equal(
    shopAuthFailure(new Error("Missing read_reports permissions")).status,
    "attention",
  );
});
test("Reconnecting discards older failures and latest connection health is independent of report dates", () => {
  const reset = {
    status: "unchecked" as const,
    message: "Reconnected",
    checkedAt: "2026-10-11T12:00:00Z",
  };
  assert.equal(
    resolvedHealth(reset, {
      error: "Old token failed",
      checked_at: "2026-10-11T11:00:00Z",
    }).status,
    "unchecked",
  );
  assert.equal(
    resolvedHealth(reset, {
      error: "Missing permissions",
      checked_at: "2026-10-11T13:00:00Z",
    }).status,
    "attention",
  );
  assert.equal(
    resolvedHealth(undefined, {
      error: null,
      checked_at: "2026-10-11T13:00:00Z",
      available: false,
    }).status,
    "unchecked",
  );
  assert.equal(resolvedHealth(undefined, undefined).status, "unchecked");
  assert.equal(
    resolvedHealth(undefined, undefined, false).status,
    "not_connected",
  );
});

test("Report quota failures do not ask users to reauthorize", () => {
  const health = resolvedHealth({status: "healthy", message: "Verified", checkedAt: "2026-10-11T12:00:00Z"}, {error: "Upstream request failed (429). Check access", checked_at: "2026-10-11T13:00:00Z"});
  assert.equal(health.status, "rate_limited");
  assert.match(health.message, /Reconnecting will not fix/);
  assert.match(new UpstreamError(429).message, /quota limit/);
});
