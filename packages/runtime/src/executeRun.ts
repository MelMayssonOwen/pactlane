import { appendEvent, runs, type Db } from "@pactlane/db";

export type StreamFn = (args: {
  system: string;
  prompt: string;
  provider: string;
  model: string;
}) => AsyncIterable<string>;

export async function executeRun(db: Db, runId: string, stream: StreamFn): Promise<void> {
  const runningUpdate = db.update(runs).set({ status: "running" });
  let runCondition: Parameters<typeof runningUpdate.where>[0] = undefined;
  const run = await db.query.runs.findFirst({
    where: (table, { eq }) => {
      runCondition = eq(table.id, runId);
      return runCondition;
    },
  });
  if (!run || !runCondition || run.status !== "queued") return; // idempotent re-delivery guard
  const agent = await db.query.agents.findFirst({
    where: (table, { eq }) => eq(table.id, run.agentId),
  });
  try {
    if (!agent) throw new Error(`agent not found: ${run.agentId}`);
    await runningUpdate.where(runCondition);
    await appendEvent(db, runId, "status", { status: "running" });
    for await (const text of stream({
      system: agent.systemPrompt,
      prompt: run.input,
      provider: agent.provider,
      model: agent.model,
    })) {
      await appendEvent(db, runId, "text", { text });
    }
    await db.update(runs).set({ status: "done", finishedAt: new Date() }).where(runCondition);
    await appendEvent(db, runId, "status", { status: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendEvent(db, runId, "error", { message });
    await db.update(runs).set({ status: "failed", error: message, finishedAt: new Date() }).where(runCondition);
    await appendEvent(db, runId, "status", { status: "failed" });
  }
}
