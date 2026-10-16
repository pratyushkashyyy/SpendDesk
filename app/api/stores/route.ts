import { recordHealth } from "@/lib/server/connection-health";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { guard } from "@/lib/server/auth";
import { db } from "@/lib/server/db";
import { encrypt } from "@/lib/server/crypto";
import { normalizeDomain } from "@/lib/reporting";
const schema = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1).max(80),
  domain: z.string().min(1).max(200),
  cid: z
    .string()
    .transform((s) => s.replace(/[-\s]/g, ""))
    .pipe(z.string().regex(/^\d{10}$/)),
  group: z.number().int().min(1).max(2147483647),
  managerCid: z
    .string()
    .default("")
    .transform((s) => s.replace(/[-\s]/g, ""))
    .pipe(z.string().regex(/^(\d{10})?$/)),
  clientId: z.string().max(200).optional(),
  clientSecret: z.string().max(500).optional(),
  accessToken: z.string().max(500).optional(),
});
export async function POST(request: Request) {
  const denied = await guard(request);
  if (denied) return denied;
  try {
    const input = schema.parse(await request.json());
    const connection =
      await db()`SELECT group_id FROM google_connections WHERE group_id=${input.group}`;
    if (!connection.length)
      return Response.json(
        { error: "Connect a Google account before assigning this store." },
        { status: 400 },
      );
    const domain = normalizeDomain(input.domain);
    if (!!input.clientId !== !!input.clientSecret)
      return Response.json(
        { error: "Enter both the Shopify client ID and secret." },
        { status: 400 },
      );
    const cipher =
      input.accessToken || input.clientId
        ? encrypt({
            clientId: input.clientId,
            clientSecret: input.clientSecret,
            accessToken: input.accessToken,
          })
        : null;
    if (input.id) {
      const old = await db()`SELECT * FROM stores WHERE id=${input.id}`;
      if (!old.length)
        return Response.json({ error: "Store not found." }, { status: 404 });
      if (old[0].domain !== domain && !cipher)
        return Response.json(
          {
            error:
              "Provide new Shopify credentials when changing the store domain.",
          },
          { status: 400 },
        );
      await db().begin(async (tx) => {
        await tx`UPDATE stores SET name=${input.name},domain=${domain},cid=${input.cid},group_id=${input.group},manager_cid=${input.managerCid},shop_cipher=COALESCE(${cipher},shop_cipher) WHERE id=${input.id!}`;
        if (old[0].domain !== domain || old[0].cid !== input.cid) {
          await tx`DELETE FROM reports WHERE store_id=${input.id!}`;
          await tx`DELETE FROM report_ranges WHERE store_id=${input.id!}`;
          await tx`DELETE FROM store_product_snapshots WHERE store_id=${input.id!}`;
          await tx`DELETE FROM product_campaign_links WHERE store_id=${input.id!}`;
        }
      });
    } else {
      await db().begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(734053)`;
        const [row] = await tx`SELECT count(*)::int AS count FROM stores`;
        if (row.count >= 25) throw new Error("limit");
        await tx`INSERT INTO stores(id,name,domain,cid,group_id,manager_cid,shop_cipher) VALUES(${randomUUID()},${input.name},${domain},${input.cid},${input.group},${input.managerCid},${cipher})`;
      });
    }
    if (cipher)
      await recordHealth(
        "shop",
        domain,
        "unchecked",
        "Shopify credentials updated. Refresh data to verify access.",
      );
    return Response.json({ ok: true });
  } catch (e: any) {
    if (e instanceof z.ZodError)
      return Response.json({ error: e.issues[0].message }, { status: 400 });
    if (e.code === "23505")
      return Response.json(
        { error: "That CID or Shopify store is already mapped." },
        { status: 409 },
      );
    return Response.json(
      {
        error:
          e.message === "limit"
            ? "All 25 store slots are in use."
            : e.message?.includes("myshopify")
              ? e.message
              : "Could not save this store. Check the database and connection settings.",
      },
      { status: 400 },
    );
  }
}
