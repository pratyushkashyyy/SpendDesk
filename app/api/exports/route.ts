import { after } from "next/server";
import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { processExportJobs } from "@/lib/server/export-jobs";
import { validDate } from "@/lib/reporting";

function prepare() {
  after(async () => {
    try {
      await processExportJobs();
    } catch {
      console.error("Export worker failed.");
    }
  });
}
export async function GET() {
  const denied = await guard();
  if (denied) return denied;
  try {
    const jobs =
      await db()`SELECT id,start_date::text AS "from",end_date::text AS "to",status,filename,error FROM export_jobs ORDER BY created_at DESC`;
    if (
      jobs.some(
        (job) => job.status === "pending" || job.status === "processing",
      )
    )
      prepare();
    return Response.json(
      { jobs },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ error: "Could not load exports." }, { status: 503 });
  }
}
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  const body = await request.json().catch(() => ({}));
  const { from, to } = body;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 365
  )
    return Response.json(
      { error: "Choose a valid date range of 366 days or less." },
      { status: 400 },
    );
  try {
    const [job] =
      await db()`INSERT INTO export_jobs(start_date,end_date,filename) VALUES(${from},${to},${`spenddesk-${from}-${to}.csv`}) RETURNING id,start_date::text AS "from",end_date::text AS "to",status,filename,error`;
    prepare();
    return Response.json({ job }, { status: 202 });
  } catch {
    return Response.json(
      { error: "Could not queue the report." },
      { status: 503 },
    );
  }
}
