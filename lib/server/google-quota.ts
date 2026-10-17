import { createHash } from "node:crypto";
import { db } from "./db";
import { googleAdsRequestError } from "./google-errors";
import type { GoogleQuotaStatus } from "../types";

export type AdsRequestContext = {
  scope: string;
  sql?: ReturnType<typeof db>;
  background?: boolean;
};
export type AdsReservation = {
  reason: "allowed" | "spacing" | "cooldown" | "background" | "exhausted";
  eventId?: number;
  used?: number;
  waitMs?: number;
  resumeAt?: string;
};
export function googleQuotaScope(clientId: string) {
  // OAuth clients in one Google Cloud project share the numeric project prefix.
  const project = clientId.match(/^(\d+)-/)?.[1] || clientId;
  return createHash("sha256").update(project).digest("hex");
}
export class GoogleQuotaPause extends Error {
  constructor(
    public reason: "background" | "exhausted" | "cooldown",
    public resumeAt?: string,
  ) {
    super(
      reason === "background"
        ? "Google API background sync paused at 80% of the rolling daily budget. Saved reports remain available; manual refreshes can use the reserved allowance."
        : reason === "exhausted"
          ? "Google API daily quota is exhausted. Google requests are paused until allowance becomes available; saved reports remain available."
          : "Google API requests are cooling down after a rate limit. Saved reports remain available; try again after the cooldown.",
    );
    this.name = "GoogleQuotaPause";
  }
}
export async function reserveGoogleRequest(
  context: AdsRequestContext,
  charge = true,
): Promise<AdsReservation> {
  const sql = context.sql || db();
  const [row] =
    await sql`SELECT reserve_google_ads_request(${context.scope},${!!context.background},${charge}) AS reservation`;
  return row.reservation;
}
export async function pauseGoogleRequests(
  context: AdsRequestContext,
  delayMs: number,
  exhausted = false,
) {
  const sql = context.sql || db();
  await sql`UPDATE google_ads_quota_state SET
    cooldown_until=GREATEST(cooldown_until,clock_timestamp()+${delayMs} * INTERVAL '1 millisecond'),
    exhausted_until=CASE WHEN ${exhausted} THEN GREATEST(exhausted_until,clock_timestamp()+${delayMs} * INTERVAL '1 millisecond') ELSE exhausted_until END
    WHERE scope=${context.scope}`;
}
export async function refundSuccessfulPage(
  context: AdsRequestContext,
  eventId: number,
) {
  const sql = context.sql || db();
  await sql`UPDATE google_ads_operations SET operations=0 WHERE id=${eventId} AND scope=${context.scope}`;
}
export async function googleQuotaStatus(
  scope: string,
  sql = db(),
): Promise<GoogleQuotaStatus> {
  const [row] =
    await sql`SELECT p.daily_limit,s.tracked_since,s.cooldown_until,s.exhausted_until,
    COALESCE(SUM(o.operations),0)::integer AS used,
    MIN(o.requested_at) FILTER (WHERE o.operations=1) + INTERVAL '24 hours' AS next_release
    FROM google_ads_quota_policy p
    LEFT JOIN google_ads_quota_state s ON s.scope=${scope}
    LEFT JOIN google_ads_operations o ON o.scope=s.scope AND o.requested_at>clock_timestamp()-INTERVAL '24 hours'
    WHERE p.singleton=TRUE GROUP BY p.daily_limit,s.tracked_since,s.cooldown_until,s.exhausted_until`;
  const used = row.used as number,
    limit = row.daily_limit as number;
  const future = (value: Date | null) =>
    value && value.getTime() > Date.now() ? value.toISOString() : null;
  return {
    used,
    limit,
    warning: used >= Math.ceil(limit * 0.7),
    backgroundPaused: used >= Math.ceil(limit * 0.8),
    exhausted: used >= limit || !!future(row.exhausted_until),
    cooldownUntil: future(row.cooldown_until),
    exhaustedUntil: future(row.exhausted_until),
    nextReleaseAt: row.next_release?.toISOString() || null,
    trackedSince: row.tracked_since?.toISOString() || null,
  };
}

export function googleQuotaError(payload: any): "temporary" | "daily" | null {
  const errors = (payload?.error?.details || []).flatMap(
    (detail: any) => detail.errors || [],
  );
  const codes = errors
    .map((error: any) => error.errorCode?.quotaError)
    .filter(Boolean);
  const quotaViolations = (payload?.error?.details || []).flatMap(
    (detail: any) => detail.violations || [],
  );
  const message = [
    payload?.error?.message,
    ...errors.map((error: any) => error.message),
    ...(payload?.error?.details || []).flatMap((detail: any) =>
      Object.values(detail.metadata || {}),
    ),
    ...quotaViolations.map(
      (v: any) => `${v.subject || ""} ${v.description || ""}`,
    ),
  ].join(" ");
  // Structured Google Ads RESOURCE_EXHAUSTED is treated conservatively as a
  // quota stop. A bare RPC status may also describe burst/response-size limits.
  if (
    codes.includes("RESOURCE_EXHAUSTED") ||
    (payload?.error?.status === "RESOURCE_EXHAUSTED" &&
      /per.?day|daily|24.?hour|operationsperday|requestsperday/i.test(message))
  )
    return "daily";
  if (
    codes.some((code: string) =>
      [
        "RESOURCE_EXHAUSTED",
        "RESOURCE_TEMPORARILY_EXHAUSTED",
        "EXCESSIVE_SHORT_TERM_QUERY_RESOURCE_CONSUMPTION",
        "EXCESSIVE_LONG_TERM_QUERY_RESOURCE_CONSUMPTION",
      ].includes(code),
    ) ||
    payload?.error?.status === "RESOURCE_EXHAUSTED"
  )
    return "temporary";
  return null;
}
export function googleRetryDelay(
  response: Response,
  payload: any,
  attempt: number,
  random = Math.random,
  now = Date.now(),
) {
  const header = response.headers.get("Retry-After");
  const headerMs = header
    ? /^\d+(\.\d+)?$/.test(header)
      ? Number(header) * 1000
      : Math.max(0, Date.parse(header) - now)
    : 0;
  const detailsMs = Math.max(
    0,
    ...(payload?.error?.details || []).map((detail: any) => {
      const delay = detail.retryDelay;
      if (typeof delay === "string" && /^\d+(\.\d+)?s$/.test(delay))
        return parseFloat(delay) * 1000;
      if (delay && typeof delay === "object")
        return (
          Number(delay.seconds || 0) * 1000 + Number(delay.nanos || 0) / 1e6
        );
      return 0;
    }),
  );
  return Math.ceil(
    Math.max(
      Number.isFinite(headerMs) ? headerMs : 0,
      detailsMs,
      30000 * 2 ** attempt,
    ) +
      random() * 5000,
  );
}

const defaults = {
  reserve: reserveGoogleRequest,
  pause: pauseGoogleRequests,
  refundPage: refundSuccessfulPage,
  fetch: (url: string, init: RequestInit) => fetch(url, init),
  sleep: (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms)),
  random: Math.random,
};
// Dependencies are injectable so retry behavior is tested without real sleeps or provider traffic.
export async function requestGoogleAds(
  url: string,
  init: RequestInit,
  context: AdsRequestContext,
  dependencies: Partial<typeof defaults> = {},
) {
  const deps = { ...defaults, ...dependencies };
  const page = !!JSON.parse(String(init.body)).pageToken;
  for (let attempt = 0; attempt < 3; attempt++) {
    let reservation: AdsReservation;
    do {
      // Reserve even pagination provisionally: an invalid page token counts as an operation.
      reservation = await deps.reserve(context, true);
      if (reservation.reason === "spacing")
        await deps.sleep(Math.max(1, reservation.waitMs || 1000));
    } while (reservation.reason === "spacing");
    if (reservation.reason !== "allowed")
      throw new GoogleQuotaPause(reservation.reason, reservation.resumeAt);
    let response: Response;
    try {
      response = await deps.fetch(url, {
        ...init,
        signal: AbortSignal.timeout(30000),
        cache: "no-store",
      });
    } catch (error) {
      // Conservatively retain a reservation when transport delivery is uncertain.
      if (attempt === 2) throw error;
      const delay = 30000 * 2 ** attempt + deps.random() * 5000;
      await deps.pause(context, delay);
      await deps.sleep(delay);
      continue;
    }
    const payload = await response.json().catch(() => null);
    if (response.ok) {
      if (!payload)
        throw new Error("Google returned an unreadable report response.");
      if (page && reservation.eventId)
        await deps.refundPage(context, reservation.eventId);
      return payload;
    }
    const quota = googleQuotaError(payload);
    if (quota === "daily") {
      // Other applications may have consumed allowance outside this app's ledger.
      await deps.pause(context, 24 * 60 * 60 * 1000, true);
      throw new GoogleQuotaPause(
        "exhausted",
        new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      );
    }
    if (
      response.status === 429 ||
      response.status >= 500 ||
      quota === "temporary"
    ) {
      const delay = googleRetryDelay(response, payload, attempt, deps.random);
      await deps.pause(context, delay);
      if (attempt < 2) {
        await deps.sleep(delay);
        continue;
      }
      throw new GoogleQuotaPause(
        "cooldown",
        new Date(Date.now() + delay).toISOString(),
      );
    }
    const failure = googleAdsRequestError(
      response.status,
      payload,
      JSON.parse(String(init.body)).query || "",
    );
    console.error(
      JSON.stringify({
        event: "google_ads_request_failed",
        ...failure.diagnostics,
      }),
    );
    throw failure.error;
  }
  throw new Error("Google reports are temporarily unavailable.");
}
