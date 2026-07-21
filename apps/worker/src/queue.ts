import PgBoss from "pg-boss";
import { createDb } from "@pactlane/db";
import { aiTurn, executeRunWithTools, type AgentTurnFn } from "@pactlane/runtime";
import { builtinTools } from "@pactlane/runtime/src/builtins.js";

export const RUN_EXECUTE = "run.execute";

export async function startWorker(opts: {
  connectionString: string;
  turn?: AgentTurnFn;
}): Promise<PgBoss> {
  const boss = new PgBoss(opts.connectionString);
  const db = createDb(opts.connectionString);
  const turn = opts.turn ?? aiTurn;
  await boss.start();
  await boss.createQueue(RUN_EXECUTE);
  await boss.work<{ runId: string }>(RUN_EXECUTE, async (jobs) => {
    for (const job of jobs) {
      await executeRunWithTools(db, job.data.runId, turn, builtinTools);
    }
  });
  return boss;
}
