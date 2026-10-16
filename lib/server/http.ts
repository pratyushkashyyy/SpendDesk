export class UpstreamError extends Error {
  constructor(
    public status: number,
    public providerCode?: string,
  ) {
    super(
      status === 429
        ? "Provider rate or quota limit reached (429). Authorization does not need reconnecting. Wait before refreshing; if this persists, check API quota and access level."
        : `Upstream request failed (${status}). Check access, permissions and API availability.`,
    );
    this.name = "UpstreamError";
  }
}
export async function fetchJson(url: string, init: RequestInit = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
    if ((response.status === 429 || response.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok) throw new UpstreamError(response.status);
      throw new Error("Provider returned an unreadable response. Try again.");
    }
    if (!response.ok)
      throw new UpstreamError(
        response.status,
        typeof payload?.error === "string" &&
          /^[a-z_]{1,80}$/.test(payload.error)
          ? payload.error
          : undefined,
      );
    return payload;
  }
  throw new Error("Provider is temporarily unavailable.");
}
