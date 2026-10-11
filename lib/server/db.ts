import postgres from "postgres";
const globalDb = globalThis as unknown as {
  storedeskSql?: ReturnType<typeof postgres>;
};
export function db() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured.");
  return (globalDb.storedeskSql ??= postgres(process.env.DATABASE_URL, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
  }));
}
export async function getSetting(key: string, sql = db()) {
  const rows = await sql`SELECT value FROM settings WHERE key=${key}`;
  return rows[0]?.value as string | undefined;
}
export async function putSetting(key: string, value: string, sql = db()) {
  await sql`INSERT INTO settings (key,value) VALUES (${key},${value}) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`;
}
