import { authorization, refreshScope } from "@/lib/server/mcp-oauth";
import { authenticated } from "@/lib/server/auth";
import McpConsent from "@/components/mcp-consent";
import SignIn from "@/components/sign-in";
export const dynamic = "force-dynamic";
export default async function Authorize({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const values = await searchParams;
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(values)) {
    if (typeof v === "string") query.set(k, v);
  }
  let allowRefresh = false;
  try {
    const grant = await authorization(query);
    allowRefresh = grant.scope.split(" ").includes(refreshScope);
  } catch {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <h1>Invalid connection request</h1>
          <p>Start the connection again from ChatGPT.</p>
        </div>
      </main>
    );
  }
  if (!(await authenticated()))
    return <SignIn returnTo={`/mcp/authorize?${query}`} />;
  return (
    <main className="auth-page">
      <div className="auth-card">
        <div className="brand">SpendDesk</div>
        <h1>Connect to ChatGPT</h1>
        <p>
          Allow ChatGPT to read your stores, saved Google Ads reports, Shopify
          order counts, campaign budgets, product performance, and sync status.
        </p>
        <p>
          Reports include their source dates and freshness. This connection
          cannot change budgets, stores, or settings.
        </p>
        {allowRefresh && (
          <p>
            This also allows ChatGPT to request fresh Google Ads and Shopify
            order reports, using provider API quota and updating saved reports.
          </p>
        )}
        <McpConsent query={query.toString()} allowRefresh={allowRefresh} />
        <a href="/">Cancel</a>
      </div>
    </main>
  );
}
