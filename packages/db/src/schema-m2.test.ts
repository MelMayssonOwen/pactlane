import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  agents,
  approvals,
  createDb,
  policies,
  projects,
  runs,
  toolInvocations,
} from "./index.js";

const url = process.env.DATABASE_URL;
const suiteName = url ? "M2 schema" : "M2 schema (skipped: DATABASE_URL is not set)";

describe.skipIf(!url)(suiteName, () => {
  it("persists policy state, approval state, an invocation ledger, and a run checkpoint", async () => {
    const db = createDb(url!);
    const checkpoint = {
      messages: [{ role: "user", content: "increment the counter" }],
      pendingCall: {
        toolCallId: "call-1",
        toolName: "counter.increment",
        args: { amount: 1 },
        argsHash: "hash-1",
      },
    };
    const [project] = await db.insert(projects).values({ name: "M2 schema test" }).returning();

    try {
      const [agent] = await db
        .insert(agents)
        .values({
          projectId: project.id,
          name: "M2 schema agent",
          provider: "openai-compatible",
          model: "test-model",
        })
        .returning();
      const [run] = await db
        .insert(runs)
        .values({
          projectId: project.id,
          agentId: agent.id,
          input: "increment the counter",
          status: "awaiting_approval",
          checkpoint,
        })
        .returning();

      await db.insert(policies).values({
        projectId: project.id,
        toolMatch: "counter.*",
        effect: "require_approval",
        priority: 10,
      });
      await db.insert(approvals).values({
        runId: run.id,
        toolCallId: "call-1",
        toolName: "counter.increment",
        args: { amount: 1 },
        argsHash: "hash-1",
      });
      const invocation = {
        runId: run.id,
        toolCallId: "call-1",
        toolName: "counter.increment",
        argsHash: "hash-1",
        status: "executed" as const,
        result: { value: 1 },
      };

      await db.insert(toolInvocations).values(invocation);
      await expect(db.insert(toolInvocations).values(invocation)).rejects.toThrow();

      const [persistedRun] = await db.select().from(runs).where(eq(runs.id, run.id));
      expect(persistedRun.checkpoint).toEqual(checkpoint);
    } finally {
      await db.delete(projects).where(eq(projects.id, project.id));
    }
  });
});
