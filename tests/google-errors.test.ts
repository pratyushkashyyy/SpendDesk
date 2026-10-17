import test from "node:test";
import assert from "node:assert/strict";
import { googleAdsRequestError } from "../lib/server/google-errors";

test("Google Ads errors retain query diagnostics without exposing provider payloads or request values", () => {
  const failure = googleAdsRequestError(
    400,
    {
      error: {
        message: "raw-secret-value",
        details: [
          {
            errors: [
              {
                errorCode: { queryError: "UNRECOGNIZED_FIELD" },
                message:
                  "Unrecognized field 'campaign.invalid_field'. Account 1234567890, token raw-secret-value",
                trigger: { stringValue: "raw-secret-value" },
              },
            ],
          },
        ],
      },
    },
    "SELECT campaign.invalid_field FROM campaign WHERE campaign.name = 'private-store'",
  );
  assert.deepEqual(failure.diagnostics, {
    status: 400,
    resource: "campaign",
    codes: ["queryError.UNRECOGNIZED_FIELD"],
    fields: ["campaign.invalid_field"],
  });
  assert.match(failure.error.message, /queryError.UNRECOGNIZED_FIELD/);
  assert.match(failure.error.message, /campaign.invalid_field/);
  for (const secret of ["raw-secret-value", "1234567890", "private-store"])
    assert.equal(
      JSON.stringify({
        message: failure.error.message,
        ...failure.diagnostics,
      }).includes(secret),
      false,
    );
});

test("Google Ads error diagnostics are bounded and tolerate absent or malformed detail arrays", () => {
  for (const payload of [null, {}, { error: { details: "not-an-array" } }]) {
    const failure = googleAdsRequestError(400, payload, "");
    assert.equal(failure.error.status, 400);
    assert.equal(failure.diagnostics.resource, "report");
    assert.deepEqual(failure.diagnostics.codes, []);
  }
  const failure = googleAdsRequestError(
    403,
    { error: { status: "PERMISSION_DENIED" } },
    "SELECT customer.id FROM customer",
  );
  assert.deepEqual(failure.diagnostics.codes, ["PERMISSION_DENIED"]);
});
