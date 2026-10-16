import { db, putSetting } from "./db";
import { googleAccess } from "./google";
import { shopAccess, shopGraphql, type ShopCredentials } from "./shopify";
import { decrypt } from "./crypto";
export async function checkConnections() {
  const connection = await db().reserve();
  let acquired = false;
  const status = {
    running: true,
    startedAt: new Date().toISOString(),
    checked: 0,
    errors: 0,
    finishedAt: undefined as string | undefined,
  };
  try {
    const [lock] =
      await connection`SELECT pg_try_advisory_lock(734055) AS acquired`;
    acquired = lock.acquired;
    if (!acquired) return;
    await putSetting(
      "connection_check_status",
      JSON.stringify(status),
      connection,
    );
    const google =
      await connection`SELECT group_id FROM google_connections ORDER BY group_id`;
    const stores =
      await connection`SELECT domain,shop_cipher FROM stores WHERE shop_cipher IS NOT NULL ORDER BY name`;
    for (const account of google) {
      try {
        await googleAccess(account.group_id, connection);
      } catch {
        status.errors++;
      }
      status.checked++;
      await putSetting(
        "connection_check_status",
        JSON.stringify(status),
        connection,
      );
    }
    // Bound provider concurrency; check authentication without preparing reports.
    for (let offset = 0; offset < stores.length; offset += 3) {
      await Promise.all(
        stores.slice(offset, offset + 3).map(async (store) => {
          try {
            const token = await shopAccess(
              store.domain,
              decrypt<ShopCredentials>(store.shop_cipher),
            );
            await shopGraphql(store.domain, token, "query { shop { id } }");
          } catch {
            status.errors++;
          }
          status.checked++;
        }),
      );
      await putSetting(
        "connection_check_status",
        JSON.stringify(status),
        connection,
      );
    }
  } finally {
    try {
      if (acquired) {
        status.running = false;
        status.finishedAt = new Date().toISOString();
        await putSetting(
          "connection_check_status",
          JSON.stringify(status),
          connection,
        );
        await connection`SELECT pg_advisory_unlock(734055)`;
      }
    } finally {
      connection.release();
    }
  }
}
