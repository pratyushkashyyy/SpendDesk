// Private deployment utility. Input is authenticated ciphertext made with the target key.
// This is only a CLI script, never an HTTP endpoint.
import { readFile, unlink } from "node:fs/promises";
import { db } from "../lib/server/db";
import { decrypt } from "../lib/server/crypto";
type State = {
  settings: { key: string; value: string }[];
  connections: { group_id: number; email: string; token_cipher: string }[];
  stores: {
    id: string;
    name: string;
    domain: string;
    cid: string;
    group_id: number;
    manager_cid: string;
    shop_cipher: string | null;
  }[];
  reports: {
    store_id: string;
    source: string;
    report_date: string;
    payload: unknown;
    error: string | null;
    checked_at: string;
  }[];
};
const file = process.argv[2];
if (!file) throw new Error("Provide the encrypted state file.");
try {
  const state = decrypt<State>((await readFile(file, "utf8")).trim());
  if (
    state.stores.length > 25 ||
    !state.settings.some((s) => s.key === "owner_password")
  )
    throw new Error("Invalid setup transfer.");
  await db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(734052)`;
    await tx`SELECT pg_advisory_xact_lock(734053)`;
    await tx`SELECT pg_advisory_xact_lock(734054)`;
    const [owner] =
      await tx`SELECT value FROM settings WHERE key='owner_password'`;
    const incomingOwner = state.settings.find(
      (s) => s.key === "owner_password",
    )!;
    if (owner && owner.value !== incomingOwner.value)
      throw new Error(
        "The hosted workspace already has a different owner. Import stopped.",
      );
    for (const c of state.connections) {
      const conflicts =
        await tx`SELECT group_id,email FROM google_connections WHERE group_id=${c.group_id} OR lower(email)=${c.email.toLowerCase()}`;
      if (
        conflicts.some(
          (row) =>
            row.group_id !== c.group_id ||
            row.email.toLowerCase() !== c.email.toLowerCase(),
        )
      )
        throw new Error("Google identity conflict. Import stopped.");
      await tx`INSERT INTO google_connections(group_id,email,token_cipher) VALUES(${c.group_id},${c.email},${c.token_cipher}) ON CONFLICT(group_id) DO UPDATE SET token_cipher=EXCLUDED.token_cipher,updated_at=now()`;
    }
    const ids = new Map<string, string>();
    for (const s of state.stores) {
      const conflicts =
        await tx`SELECT id,cid,domain FROM stores WHERE domain=${s.domain} OR cid=${s.cid} OR id=${s.id} FOR UPDATE`;
      if (conflicts.some((row) => row.cid !== s.cid || row.domain !== s.domain))
        throw new Error("Store mapping conflict. Import stopped.");
      const id = conflicts[0]?.id || s.id;
      ids.set(s.id, id);
      await tx`INSERT INTO stores(id,name,domain,cid,group_id,manager_cid,shop_cipher) VALUES(${id},${s.name},${s.domain},${s.cid},${s.group_id},${s.manager_cid},${s.shop_cipher}) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,group_id=EXCLUDED.group_id,manager_cid=EXCLUDED.manager_cid,shop_cipher=EXCLUDED.shop_cipher`;
    }
    const [count] = await tx`SELECT count(*)::int AS count FROM stores`;
    if (count.count > 25)
      throw new Error("Store limit exceeded. Import stopped.");
    for (const s of state.settings) {
      if (!["owner_password", "google_config", "sync_status"].includes(s.key))
        throw new Error("Unexpected setup setting.");
      await tx`INSERT INTO settings(key,value) VALUES(${s.key},${s.value}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    }
    for (const r of state.reports) {
      const id = ids.get(r.store_id);
      if (!id) throw new Error("Report does not belong to an imported store.");
      await tx`INSERT INTO reports(store_id,source,report_date,payload,error,checked_at) VALUES(${id},${r.source},${r.report_date},${tx.json(r.payload as any)},${r.error},${r.checked_at}) ON CONFLICT(store_id,source,report_date) DO UPDATE SET payload=EXCLUDED.payload,error=EXCLUDED.error,checked_at=EXCLUDED.checked_at WHERE reports.checked_at < EXCLUDED.checked_at`;
    }
    await tx`SELECT setval('google_connection_id_seq',GREATEST((SELECT max(group_id) FROM google_connections),1))`;
  });
  await unlink(file);
  console.log(
    JSON.stringify({
      importedStores: state.stores.length,
      importedGoogleAccounts: state.connections.length,
      importedReports: state.reports.length,
    }),
  );
} finally {
  await db().end();
}
