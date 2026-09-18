import { after } from "next/server";
import { guard } from "@/lib/server/auth";
import { syncReports } from "@/lib/server/sync";
import { validDate } from "@/lib/reporting";
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  if (body.date && !validDate(body.date))
    return Response.json({ error: "Invalid date." }, { status: 400 });
  if (!process.env.DATABASE_URL)
    return Response.json(
      { error: "Connect a database first." },
      { status: 503 },
    );
  after(async () => {
    try {
      await syncReports(body.date);
    } catch {
      console.error("Manual report sync failed.");
    }
  });
  return Response.json(
    {
      ok: true,
      message: "Sync requested. Reports will update as each account finishes.",
    },
    { status: 202 },
  );
}
