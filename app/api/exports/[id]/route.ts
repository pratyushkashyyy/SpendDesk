import { z } from "zod";
import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await guard();
  if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Invalid export." }, { status: 400 });
  try {
    // The client removes the file only after receiving the complete CSV.
    const [job] =
      await db()`SELECT csv,filename FROM export_jobs WHERE id=${id} AND status='ready'`;
    if (!job)
      return Response.json(
        { error: "This report is not ready or has already been downloaded." },
        { status: 404 },
      );
    return new Response(job.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${job.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "Could not download the report." },
      { status: 503 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await guard(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success)
    return Response.json({ error: "Invalid export." }, { status: 400 });
  try {
    await db()`DELETE FROM export_jobs WHERE id=${id} AND status='ready'`;
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      {
        error:
          "The download completed but its temporary file could not be removed. Try again.",
      },
      { status: 503 },
    );
  }
}
