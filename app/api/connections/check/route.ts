import { after } from "next/server";
import { guard } from "@/lib/server/auth";
import { checkConnections } from "@/lib/server/check-connections";
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  after(async () => {
    try {
      await checkConnections();
    } catch {
      console.error("Connection access check failed.");
    }
  });
  return Response.json(
    {
      ok: true,
      message:
        "Checking Google and Shopify access. Statuses update as each connection finishes.",
    },
    { status: 202 },
  );
}
