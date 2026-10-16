import { healthKey } from "./connection-health";
import { db } from "./db";
import { encrypt } from "./crypto";

export async function saveGoogleConnection(
  email: string,
  refreshToken: string,
  requestedGroup: number | null,
) {
  return db().begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(734054)`;
    const normalized = email.toLowerCase();
    const existing =
      await tx`SELECT group_id FROM google_connections WHERE lower(email)=${normalized}`;
    // Reconnecting must never replace the identity used by existing store mappings.
    if (requestedGroup !== null && existing[0]?.group_id !== requestedGroup)
      return false;
    const cipher = encrypt({ refreshToken });
    if (existing.length)
      await tx`UPDATE google_connections SET token_cipher=${cipher},updated_at=now() WHERE group_id=${existing[0].group_id}`;
    else
      await tx`INSERT INTO google_connections(email,token_cipher) VALUES(${normalized},${cipher})`;
    const [saved] =
      await tx`SELECT group_id FROM google_connections WHERE lower(email)=${normalized}`;
    await tx`INSERT INTO settings(key,value) VALUES(${healthKey("google", saved.group_id)},${JSON.stringify({ status: "unchecked", message: "Google account reconnected. Refresh data to verify access.", checkedAt: new Date().toISOString() })}) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`;
    return true;
  });
}
