import { db } from "./db";
import { buildExport } from "./export";
import { syncReports } from "./sync";

export async function processExportJobs() {
  const lock = await db().reserve();
  let acquired = false;
  try {
    const [result] =
      await lock`SELECT pg_try_advisory_lock(734053) AS acquired`;
    acquired = result.acquired;
    if (!acquired) return;
    // A processing row without this lock belongs to an interrupted worker.
    for (let count = 0; count < 5; count++) {
      const [job] =
        await lock`UPDATE export_jobs SET status='processing',updated_at=now(),error=NULL WHERE id=(SELECT id FROM export_jobs WHERE status IN ('pending','processing') ORDER BY created_at LIMIT 1) RETURNING id,start_date::text AS "from",end_date::text AS "to"`;
      if (!job) break;
      try {
        const sync = await syncReports(job.from, job.to, true);
        if (sync.busy) {
          await lock`UPDATE export_jobs SET status='pending',updated_at=now() WHERE id=${job.id}`;
          break;
        }
        const response = await buildExport(job.from, job.to);
        if (!response.ok) throw new Error((await response.json()).error);
        const csv = await response.text();
        await lock`UPDATE export_jobs SET status='ready',csv=${csv},updated_at=now() WHERE id=${job.id}`;
      } catch {
        await lock`UPDATE export_jobs SET status='failed',error='Could not generate this report. Try exporting again.',updated_at=now() WHERE id=${job.id}`;
      }
    }
  } finally {
    try {
      if (acquired) await lock`SELECT pg_advisory_unlock(734053)`;
    } finally {
      lock.release();
    }
  }
}
