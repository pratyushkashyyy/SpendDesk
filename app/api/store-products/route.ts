import { z } from "zod";
import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { dateInZone, validDate } from "@/lib/reporting";
import { storeProducts } from "@/lib/server/store-products";
const idSchema = z.uuid();
async function context(id: string, startDate?: string, endDate?: string) {
  const [store] = await db()`SELECT * FROM stores WHERE id=${id}`;
  if (!store) return null;
  const [report] =
    await db()`SELECT payload FROM reports WHERE store_id=${id} AND source='ads' AND payload IS NOT NULL ORDER BY checked_at DESC LIMIT 1`;
  const timezone = report?.payload?.timezone || "Asia/Kolkata";
  return {
    store,
    timezone,
    currency: report?.payload?.currency || "",
    startDate: startDate || dateInZone(timezone, -1),
    endDate: endDate || startDate || dateInZone(timezone, -1),
  };
}
export async function GET(request: Request) {
  const denied = await guard();
  if (denied) return denied;
  const url = new URL(request.url);
  const id = url.searchParams.get("id");
  const startDate = url.searchParams.get("from") || undefined;
  const endDate = url.searchParams.get("to") || startDate;
  if (
    !idSchema.safeParse(id).success ||
    (startDate && !validDate(startDate)) ||
    (endDate && !validDate(endDate)) ||
    (startDate && endDate && startDate > endDate)
  )
    return Response.json(
      { error: "Choose a valid store and report date." },
      { status: 400 },
    );
  try {
    const c = await context(id!, startDate, endDate);
    if (!c)
      return Response.json({ error: "Store not found." }, { status: 404 });
    return Response.json(
      await storeProducts(
        c.store,
        c.startDate,
        c.endDate,
        c.currency,
        c.timezone,
      ),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Could not load products. Check the database and try again." },
      { status: 503 },
    );
  }
}
const inputSchema = z.object({
  id: z.uuid(),
  from: z.string().refine(validDate),
  to: z.string().refine(validDate),
  action: z.enum(["link", "unlink", "refresh"]),
  productId: z
    .string()
    .regex(/^gid:\/\/shopify\/Product\/\d+$/)
    .optional(),
  campaignId: z.string().regex(/^\d+$/).optional(),
});
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const input = inputSchema.parse(await request.json());
    if (input.from > input.to)
      return Response.json(
        { error: "Choose a valid date range." },
        { status: 400 },
      );
    const c = await context(input.id, input.from, input.to);
    if (!c)
      return Response.json({ error: "Store not found." }, { status: 404 });
    if (input.action === "refresh")
      return Response.json(
        await storeProducts(
          c.store,
          c.startDate,
          c.endDate,
          c.currency,
          c.timezone,
          true,
        ),
      );
    if (!input.productId || !input.campaignId)
      return Response.json(
        { error: "Choose a product and campaign." },
        { status: 400 },
      );
    // Validate identifiers against this store’s own snapshot; never accept cross-store links.
    const [snapshot] =
      await db()`SELECT payload FROM store_product_snapshots WHERE store_id=${input.id} AND start_date=${input.from} AND end_date=${input.to}`;
    if (input.action === "link") {
      if (
        !snapshot?.payload.products.some(
          (p: any) => p.id === input.productId,
        ) ||
        !snapshot?.payload.campaigns.some((p: any) => p.id === input.campaignId)
      )
        return Response.json(
          {
            error:
              "Load this store’s products and campaigns before linking them.",
          },
          { status: 400 },
        );
      await db()`INSERT INTO product_campaign_links(store_id,product_id,campaign_id) VALUES(${input.id},${input.productId},${input.campaignId}) ON CONFLICT DO NOTHING`;
    } else
      await db()`DELETE FROM product_campaign_links WHERE store_id=${input.id} AND product_id=${input.productId} AND campaign_id=${input.campaignId}`;
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json(
      {
        error:
          e instanceof z.ZodError
            ? "Choose a valid product, campaign, and date."
            : "Could not save the product link. Try again.",
      },
      { status: e instanceof z.ZodError ? 400 : 503 },
    );
  }
}
