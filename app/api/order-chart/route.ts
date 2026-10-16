import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { buildOrderChart, comparisonRange } from "@/lib/order-chart";
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const params = new URL(request.url).searchParams,
    id = params.get("id"),
    from = params.get("from") || "",
    to = params.get("to") || "",
    comparison = params.get("comparison") || "period";
  if (
    !id ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(
      id,
    ) ||
    !["period", "month"].includes(comparison)
  )
    return Response.json(
      { error: "Choose a valid store and comparison." },
      { status: 400 },
    );
  let previous;
  try {
    previous = comparisonRange(from, to, comparison as "period" | "month");
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  const [store] = await db()`SELECT id FROM stores WHERE id=${id}::uuid`;
  if (!store)
    return Response.json({ error: "Store not found." }, { status: 404 });
  const [latest] =
    await db()`SELECT payload->>'timezone' AS timezone FROM reports WHERE store_id=${id}::uuid AND source='shop' AND payload IS NOT NULL ORDER BY checked_at DESC LIMIT 1`;
  const zone = latest?.timezone || "Asia/Kolkata";
  const first = [from, previous.from].sort()[0],
    last = [to, previous.to].sort().at(-1)!;
  const [reports, observations] = await Promise.all([
    db()`SELECT report_date::text,payload,error FROM reports WHERE store_id=${id}::uuid AND source='shop' AND report_date BETWEEN ${first}::date AND ${last}::date`,
    from === to
      ? db()`SELECT report_date::text,payload FROM report_observations WHERE store_id=${id}::uuid AND source='shop' AND report_date IN (${from}::date,${previous.from}::date) ORDER BY observed_at DESC LIMIT 3000`
      : Promise.resolve([]),
  ]);
  // Chart reads only saved data. Opening it never launches a provider sync.
  return Response.json(
    buildOrderChart(
      from,
      to,
      comparison as "period" | "month",
      zone,
      reports as any,
      observations as any,
    ),
  );
}
