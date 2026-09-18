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
    const payload = await response.json();
    if (!response.ok)
      throw new Error(
        `Upstream request failed (${response.status}). Check access, permissions and API availability.`,
      );
    return payload;
  }
  throw new Error("Provider is temporarily unavailable.");
}
