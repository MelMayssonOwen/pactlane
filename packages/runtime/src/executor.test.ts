import {
  agents,
  createDb,
  policies,
  projects,
  runs,
  type Db,
  type PolicyEffect,
} from "@pactlane/db";
import { beforeEach, describe, expect, it } from "vitest";
import { invokeTool } from "./executor.js";
import { RunSuspended, type ToolDef } from "./tools.js";

const url = process.env.DATABASE_URL;
const suiteName = url ? "invokeTool" : "invokeTool (skipped: DATABASE_URL is not set)";

let destructiveCounter = 0;

const counterTool: ToolDef = {
  name: "counter.increment",
  description: "Increment a destructive test counter",
  inputSchema: {
    safeParse(value: unknown) {
      const amount = (value as { amount?: unknown } | null)?.amount;
      return typeof amount === "number"
        ? { success: true, data: { amount } }
        : { success: false, error: new Error("amount must be a number") };
    },
  } as unknown as ToolDef["inputSchema"],
  async execute(args) {
    destructiveCounter += (args as { amount: number }).amount;
    return { value: destructiveCounter };
  },
};

type SeededRun = {
  db: Db;
  projectId: string;
  runId: string;
};

async function seed(effect?: PolicyEffect): Promise<SeededRun> {
  const db = createDb(url!);
  const [project] = await db.insert(projects).values({ name: "ToolExecutor test" }).returning();
  const [agent] = await db
    .insert(agents)
    .values({
      projectId: project.id,
      name: "ToolExecutor test agent",
      provider: "openai-compatible",
      model: "test-model",
    })
    .returning();
  const [run] = await db
    .insert(runs)
    .values({ projectId: project.id, agentId: agent.id, input: "increment" })
    .returning();

  if (effect) {
    await db.insert(policies).values({
      projectId: project.id,
      toolMatch: "counter.*",
      effect,
      priority: 0,
    });
  }

  return { db, projectId: project.id, runId: run.id };
}

async function cleanup(seeded: SeededRun): Promise<void> {
  await seeded.db.$client.query("delete from projects where id = $1", [seeded.projectId]);
  await seeded.db.$client.end();
}

function increment(seeded: SeededRun, args: unknown = { amount: 1 }) {
  return invokeTool(
    { db: seeded.db, runId: seeded.runId, projectId: seeded.projectId },
    [counterTool],
    { toolCallId: "call-1", toolName: "counter.increment", args },
  );
}

async function approvalRows(seeded: SeededRun) {
  return seeded.db.query.approvals.findMany({
    where: (table, { eq }) => eq(table.runId, seeded.runId),
  });
}

async function invocationRows(seeded: SeededRun) {
  return seeded.db.query.toolInvocations.findMany({
    where: (table, { eq }) => eq(table.runId, seeded.runId),
  });
}

describe.skipIf(!url)(suiteName, () => {
  beforeEach(() => {
    destructiveCounter = 0;
  });

  it("executes an allowed tool and records the result in the ledger", async () => {
    const seeded = await seed("allow");
    try {
      await expect(increment(seeded)).resolves.toEqual({ ok: true, result: { value: 1 } });
      expect(destructiveCounter).toBe(1);
      await expect(invocationRows(seeded)).resolves.toMatchObject([
        { toolCallId: "call-1", status: "executed", result: { value: 1 } },
      ]);
    } finally {
      await cleanup(seeded);
    }
  });

  it("returns a stored result without executing the same toolCallId twice", async () => {
    const seeded = await seed("allow");
    try {
      await expect(increment(seeded)).resolves.toEqual({ ok: true, result: { value: 1 } });
      await expect(increment(seeded)).resolves.toEqual({ ok: true, result: { value: 1 } });
      expect(destructiveCounter).toBe(1);
      await expect(invocationRows(seeded)).resolves.toHaveLength(1);
    } finally {
      await cleanup(seeded);
    }
  });

  it("denies a tool without executing it when policy says deny", async () => {
    const seeded = await seed("deny");
    try {
      await expect(increment(seeded)).resolves.toEqual({ ok: false, error: "denied by policy" });
      expect(destructiveCounter).toBe(0);
      await expect(invocationRows(seeded)).resolves.toMatchObject([{ status: "denied" }]);
    } finally {
      await cleanup(seeded);
    }
  });

  it("denies by default when no policy matches", async () => {
    const seeded = await seed();
    try {
      await expect(increment(seeded)).resolves.toEqual({ ok: false, error: "denied by policy" });
      expect(destructiveCounter).toBe(0);
    } finally {
      await cleanup(seeded);
    }
  });

  it("suspends once for a pending approval and never executes while waiting", async () => {
    const seeded = await seed("require_approval");
    try {
      await expect(increment(seeded)).rejects.toBeInstanceOf(RunSuspended);
      const firstRows = await approvalRows(seeded);
      expect(firstRows).toMatchObject([{ status: "pending", args: { amount: 1 } }]);

      await expect(increment(seeded)).rejects.toMatchObject({ approvalId: firstRows[0]!.id });
      const secondRows = await approvalRows(seeded);
      expect(secondRows).toHaveLength(1);
      expect(secondRows[0]!.id).toBe(firstRows[0]!.id);
      expect(destructiveCounter).toBe(0);
    } finally {
      await cleanup(seeded);
    }
  });

  it("executes an approved call exactly once", async () => {
    const seeded = await seed("require_approval");
    try {
      await expect(increment(seeded)).rejects.toBeInstanceOf(RunSuspended);
      const [approval] = await approvalRows(seeded);
      await seeded.db.$client.query("update approvals set status = 'approved' where id = $1", [approval!.id]);

      await expect(increment(seeded)).resolves.toEqual({ ok: true, result: { value: 1 } });
      await expect(increment(seeded)).resolves.toEqual({ ok: true, result: { value: 1 } });
      expect(destructiveCounter).toBe(1);
      await expect(invocationRows(seeded)).resolves.toHaveLength(1);
    } finally {
      await cleanup(seeded);
    }
  });

  it("rejects approved calls whose arguments no longer match the frozen hash", async () => {
    const seeded = await seed("require_approval");
    try {
      await expect(increment(seeded, { amount: 1 })).rejects.toBeInstanceOf(RunSuspended);
      const [approval] = await approvalRows(seeded);
      await seeded.db.$client.query("update approvals set status = 'approved' where id = $1", [approval!.id]);

      await expect(increment(seeded, { amount: 2 })).resolves.toEqual({
        ok: false,
        error: "frozen args mismatch",
      });
      expect(destructiveCounter).toBe(0);
      await expect(invocationRows(seeded)).resolves.toMatchObject([
        { toolCallId: "call-1", status: "failed" },
      ]);
    } finally {
      await cleanup(seeded);
    }
  });
});

import { describe as describe2, expect as expect2, it as it2 } from "vitest";
// Validator addition: exactly-once under concurrent duplicate delivery.

describe(url ? "invokeTool exactly-once under concurrency" : "invokeTool concurrency (skipped: DATABASE_URL is not set)", () => {
  it.skipIf(!url)("concurrent duplicate deliveries execute the side effect once", async () => {
    const { db, projectId, runId } = await seed("allow");
    const before = destructiveCounter;
    const slow: ToolDef = {
      ...counterTool,
      async execute(args) {
        await new Promise((r) => setTimeout(r, 100));
        destructiveCounter += (args as { amount: number }).amount;
        return { value: destructiveCounter };
      },
    };
    const call = { toolCallId: "cc-1", toolName: "counter.increment", args: { amount: 1 } };
    const results = await Promise.all([
      invokeTool({ db, runId, projectId }, [slow], call),
      invokeTool({ db, runId, projectId }, [slow], call),
    ]);
    expect(destructiveCounter).toBe(before + 1);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
