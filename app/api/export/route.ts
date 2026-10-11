import { guard } from "@/lib/server/auth";
import { buildExport } from "@/lib/server/export";
import { validDate } from "@/lib/reporting";
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(request.url),
    from = url.searchParams.get("from"),
    to = url.searchParams.get("to");
  if (
    !from ||
    !to ||
    !validDate(from) ||
    !validDate(to) ||
    from > to ||
    (Date.parse(to) - Date.parse(from)) / 86400000 > 365
  )
    return Response.json(
      { error: "Choose a valid date range of 366 days or less." },
      { status: 400 },
    );
  return buildExport(from, to);
}
