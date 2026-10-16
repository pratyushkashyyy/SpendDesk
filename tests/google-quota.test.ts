import { test } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleQuotaPause,
  googleQuotaError,
  googleQuotaScope,
  googleRetryDelay,
  requestGoogleAds,
  type AdsReservation,
} from "../lib/server/google-quota";
const context = { scope: "fixture", background: true };
const input = {
  method: "POST",
  body: JSON.stringify({ query: "SELECT campaign.id FROM campaign" }),
};
const temporary = {
  error: {
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        errors: [
          { errorCode: { quotaError: "RESOURCE_TEMPORARILY_EXHAUSTED" } },
        ],
      },
    ],
  },
};
const daily = {
  error: {
    status: "RESOURCE_EXHAUSTED",
    message: "Daily operations quota exceeded",
    details: [
      { errors: [{ errorCode: { quotaError: "RESOURCE_EXHAUSTED" } }] },
    ],
  },
};

test("quota scope is shared by OAuth clients in one Cloud project without exposing credentials", () => {
  assert.equal(
    googleQuotaScope("123456-a.apps.googleusercontent.com"),
    googleQuotaScope("123456-b.apps.googleusercontent.com"),
  );
  assert.notEqual(googleQuotaScope("123456-a"), googleQuotaScope("789012-a"));
  assert.match(googleQuotaScope("private-client"), /^[a-f0-9]{64}$/);
});
test("Google quota details distinguish daily exhaustion from temporary throttles", () => {
  assert.equal(googleQuotaError(daily), "daily");
  assert.equal(
    googleQuotaError({
      error: {
        details: [
          { errors: [{ errorCode: { quotaError: "RESOURCE_EXHAUSTED" } }] },
        ],
      },
    }),
    "daily",
  );
  assert.equal(googleQuotaError(temporary), "temporary");
  assert.equal(
    googleQuotaError({ error: { status: "RESOURCE_EXHAUSTED" } }),
    "temporary",
  );
  assert.equal(
    googleQuotaError({ error: { status: "PERMISSION_DENIED" } }),
    null,
  );
});
test("retry delays use exponential backoff and jitter and honor provider retry hints", () => {
  assert.equal(
    googleRetryDelay(new Response(), {}, 0, () => 0.5),
    32500,
  );
  assert.equal(
    googleRetryDelay(new Response(), {}, 1, () => 0),
    60000,
  );
  assert.equal(
    googleRetryDelay(
      new Response(null, { headers: { "Retry-After": "120" } }),
      {},
      0,
      () => 0,
    ),
    120000,
  );
  assert.equal(
    googleRetryDelay(
      new Response(),
      { error: { details: [{ retryDelay: "90s" }] } },
      0,
      () => 0,
    ),
    90000,
  );
  const now = Date.parse("2026-10-16T00:00:00Z");
  assert.equal(
    googleRetryDelay(
      new Response(null, {
        headers: { "Retry-After": "Fri, 16 Oct 2026 00:02:00 GMT" },
      }),
      {},
      0,
      () => 0,
      now,
    ),
    120000,
  );
});
test("each throttled retry is paced, counted, and publishes a shared cooldown", async () => {
  let calls = 0,
    reservations = 0;
  const delays: number[] = [],
    pauses: number[] = [];
  const data = await requestGoogleAds("https://fixture", input, context, {
    reserve: async () => {
      reservations++;
      return { reason: "allowed", eventId: reservations };
    },
    fetch: async () =>
      ++calls < 3
        ? Response.json(temporary, { status: 429 })
        : Response.json({ results: [1] }),
    pause: async (_context, delay) => {
      pauses.push(delay);
    },
    sleep: async (delay) => {
      delays.push(delay);
    },
    random: () => 0,
  });
  assert.deepEqual(data.results, [1]);
  assert.equal(calls, 3);
  assert.equal(reservations, 3);
  assert.deepEqual(delays, [30000, 60000]);
  assert.deepEqual(pauses, delays);
});
test("daily exhaustion pauses all clients for a day without retrying", async () => {
  let calls = 0;
  await assert.rejects(
    requestGoogleAds("https://fixture", input, context, {
      reserve: async () => ({ reason: "allowed", eventId: 1 }),
      fetch: async () => {
        calls++;
        return Response.json(daily, { status: 429 });
      },
      pause: async (_context, delay, exhausted) => {
        assert.equal(delay, 86400000);
        assert.equal(exhausted, true);
      },
      sleep: async () => {
        assert.fail("daily exhaustion must not retry");
      },
    }),
    (error: unknown) =>
      error instanceof GoogleQuotaPause && error.reason === "exhausted",
  );
  assert.equal(calls, 1);
});
test("background budgets and shared cooldowns block HTTP calls; spacing waits without debiting twice", async () => {
  for (const reason of ["background", "exhausted", "cooldown"] as const) {
    await assert.rejects(
      requestGoogleAds("https://fixture", input, context, {
        reserve: async () => ({ reason }),
        fetch: async () => {
          assert.fail("paused clients cannot contact Google");
        },
      }),
      GoogleQuotaPause,
    );
  }
  const sequence: AdsReservation[] = [
    { reason: "spacing", waitMs: 500 },
    { reason: "allowed" },
  ];
  await requestGoogleAds("https://fixture", input, context, {
    reserve: async () => sequence.shift()!,
    fetch: async () => Response.json({ results: [] }),
    sleep: async (delay) => {
      assert.equal(delay, 500);
    },
  });
  assert.equal(sequence.length, 0);
});
test("valid pagination does not consume another operation; failed page requests are charged", async () => {
  const page = { ...input, body: JSON.stringify({ pageToken: "valid" }) };
  let refunded = 0;
  const dependencies = {
    reserve: async (
      _context: unknown,
      charge = true,
    ): Promise<AdsReservation> => {
      assert.equal(charge, true);
      return { reason: "allowed", eventId: 8 };
    },
    refundPage: async () => {
      refunded++;
    },
  };
  await requestGoogleAds("https://fixture", page, context, {
    ...dependencies,
    fetch: async () => Response.json({ results: [] }),
  });
  assert.equal(refunded, 1);
  await assert.rejects(
    requestGoogleAds("https://fixture", page, context, {
      ...dependencies,
      fetch: async () => Response.json({ error: {} }, { status: 400 }),
    }),
  );
  assert.equal(refunded, 1);
});
