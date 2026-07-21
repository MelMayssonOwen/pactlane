import PgBoss from "pg-boss";
import { createDb } from "@pactlane/db";
import { aiStream, executeRun, type StreamFn } from "@pactlane/runtime";

export const RUN_EXECUTE = "run.execute";

export async function startWorker(opts: { connectionString: string; stream?: StreamFn }): Promise<PgBoss> {
  const boss = new PgBoss(opts.connectionString);
  const db = createDb(opts.connectionString);
  const stream = opts.stream ?? aiStream;
  await boss.start();
  await boss.createQueue(RUN_EXECUTE);
  await boss.work<{ runId: string }>(RUN_EXECUTE, async (jobs) => {
    for (const job of jobs) {
      await executeRun(db, job.data.runId, stream);
    }
  });
  return boss;
}
