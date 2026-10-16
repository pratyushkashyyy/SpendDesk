import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { refreshBudgetHistory } from "@/lib/server/budget-history";
import { buildBudgetHistory } from "@/lib/budget-history";
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  let id: string;
  try {
    id = (await request.json()).id;
  } catch {
    return Response.json({ error: "Choose a store." }, { status: 400 });
  }
  if (
    typeof id !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    return Response.json({ error: "Choose a valid store." }, { status: 400 });
  const [state] =
    await db()`SELECT store_id FROM budget_states WHERE store_id=${id}::uuid`;
  if (!state)
    return Response.json(
      {
        error:
          "Sync a report to establish the current budget configuration first.",
      },
      { status: 404 },
    );
  const result = await refreshBudgetHistory({ storeId: id, background: false });
  if (result?.busy)
    return Response.json(
      {
        busy: true,
        message:
          "Another budget history refresh is running. Saved data will update shortly.",
      },
      { status: 202 },
    );
  if (!result?.updated)
    return Response.json(
      {
        error:
          "Connect the Google login assigned to this store to read its edit history.",
      },
      { status: 400 },
    );
  const [states, events, observed] = await Promise.all([
    db()`SELECT * FROM budget_states WHERE store_id=${id}::uuid`,
    db()`SELECT * FROM google_budget_events WHERE store_id=${id}::uuid ORDER BY changed_at DESC LIMIT 30`,
    db()`SELECT * FROM budget_observed_changes WHERE store_id=${id}::uuid ORDER BY observed_at DESC LIMIT 20`,
  ]);
  return Response.json({
    history: buildBudgetHistory(
      states[0] as any,
      events as any,
      observed as any,
    ),
  });
}
