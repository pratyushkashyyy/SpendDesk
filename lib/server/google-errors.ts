import { UpstreamError } from "./http";

// Keep Google's actionable enum codes and field names, never its raw response,
// query values, authorization headers, credentials, or account identifiers.
export function googleAdsRequestError(
  status: number,
  payload: any,
  query: string,
) {
  const codes = new Set<string>();
  const fields = new Set<string>();
  const details = Array.isArray(payload?.error?.details)
    ? payload.error.details
    : [];
  const errors = details.flatMap((detail: any) =>
    Array.isArray(detail?.errors) ? detail.errors : [],
  );
  for (const error of errors) {
    for (const [kind, value] of Object.entries(error?.errorCode || {}))
      if (
        /^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(kind) &&
        typeof value === "string" &&
        /^[A-Z][A-Z0-9_]{0,100}$/.test(value)
      )
        codes.add(`${kind}.${value}`);
    if (typeof error?.message === "string")
      for (const match of error.message.matchAll(
        /\b(?:customer|campaign|campaign_budget|bidding_strategy|ad_group_ad|asset_group_asset|change_event|segments|metrics|shopping_performance_view)\.[a-z][a-z0-9_.]{0,120}\b/g,
      ))
        fields.add(match[0]);
  }
  if (
    !codes.size &&
    typeof payload?.error?.status === "string" &&
    /^[A-Z][A-Z0-9_]{0,100}$/.test(payload.error.status)
  )
    codes.add(payload.error.status);
  const resource =
    query.match(/\bFROM\s+([a-z_]+)\b/i)?.[1]?.toLowerCase() || "report";
  const diagnostics = {
    status,
    resource,
    codes: [...codes].slice(0, 8),
    fields: [...fields].slice(0, 12),
  };
  const error = new UpstreamError(status, diagnostics.codes[0]);
  error.message = `Google Ads rejected the ${resource} request (${status})${diagnostics.codes.length ? `: ${diagnostics.codes.join(", ")}` : "."}${diagnostics.fields.length ? ` Fields: ${diagnostics.fields.join(", ")}.` : ""}`;
  return { error, diagnostics };
}
