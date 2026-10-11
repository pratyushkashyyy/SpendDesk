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
  if (
    body.from &&
    (!validDate(body.from) ||
      !validDate(body.to) ||
      body.from > body.to ||
      (Date.parse(body.to) - Date.parse(body.from)) / 86400000 > 365)
  )
    return Response.json(
      { error: "Choose a valid date range of 366 days or less." },
      { status: 400 },
    );
  if (!process.env.DATABASE_URL)
    return Response.json(
      { error: "Connect a database first." },
      { status: 503 },
    );
  after(async () => {
    try {
      await syncReports(
        body.from || body.date,
        body.from ? body.to : undefined,
        body.missingOnly === true,
      );
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
