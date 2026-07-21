import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { runEvents } from "./schema.js";

export async function appendEvent(db: Db, runId: string, type: string, payload: unknown): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${runId}))`);
    const [{ next }] = (
      await tx.execute<{ next: number }>(
        sql`select coalesce(max(seq), 0) + 1 as next from run_events where run_id = ${runId}`,
      )
    ).rows;
    await tx.insert(runEvents).values({ runId, seq: next, type, payload });
    return next;
  });
}
