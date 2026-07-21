import {
  agents,
  approvals,
  createDb,
  policies,
  projects,
  runs,
  type Db,
  type PolicyEffect,
} from "@pactlane/db";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  executeRunWithTools,
  type AgentTurnFn,
  type TurnEvent,
} from "./executeRun.js";
import { hashArgs } from "./hash.js";
import type { ToolDef } from "./tools.js";

const url = process.env.DATABASE_URL;
const suiteName = url
  ? "executeRunWithTools"
  : "executeRunWithTools (skipped: DATABASE_URL is not set)";

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

async function seed(effect: PolicyEffect): Promise<SeededRun> {
  const db = createDb(url!);
  const [project] = await db.insert(projects).values({ name: "Tool loop test" }).returning();
  const [agent] = await db
    .insert(agents)
    .values({
      projectId: project!.id,
      name: "Tool loop test agent",
      provider: "openai-compatible",
      model: "test-model",
      systemPrompt: "Use the counter tool once.",
    })
    .returning();
  const [run] = await db
    .insert(runs)
    .values({ projectId: project!.id, agentId: agent!.id, input: "increment" })
    .returning();

  await db.insert(policies).values({
    projectId: project!.id,
    toolMatch: "counter.*",
    effect,
    priority: 0,
  });

  return { db, projectId: project!.id, runId: run!.id };
}

async function cleanup(seeded: SeededRun): Promise<void> {
  await seeded.db.$client.query("delete from projects where id = $1", [seeded.projectId]);
  await seeded.db.$client.end();
}

const scriptedTurn: AgentTurnFn = async function* ({ messages }): AsyncIterable<TurnEvent> {
  if (messages.some((message) => message.role === "tool")) {
    yield { type: "text", text: "done" };
  } else {
    yield {
      type: "tool-call",
      toolCallId: "call-1",
      toolName: "counter.increment",
      args: { amount: 1 },
    };
  }
  yield { type: "finish" };
};

async function loadRun(seeded: SeededRun) {
  return seeded.db.query.runs.findFirst({
    where: (table, { eq }) => eq(table.id, seeded.runId),
  });
}

async function approvalRows(seeded: SeededRun) {
  return seeded.db.query.approvals.findMany({
    where: (table, { eq }) => eq(table.runId, seeded.runId),
  });
}

async function setDecision(seeded: SeededRun, status: "approved" | "denied"): Promise<void> {
  await seeded.db
    .update(approvals)
    .set({ status, decidedBy: "test", decidedAt: new Date() })
    .where(eq(approvals.runId, seeded.runId));
}

describe.skipIf(!url)(suiteName, () => {
  beforeEach(() => {
    destructiveCounter = 0;
  });

  it("completes an allowed tool call and records policy, call, and result events", async () => {
    const seeded = await seed("allow");
    try {
      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);

      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "done", checkpoint: null });
      expect(destructiveCounter).toBe(1);

      const events = await seeded.db.query.runEvents.findMany({
        where: (table, { eq }) => eq(table.runId, seeded.runId),
      });
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["policy", "tool_call", "tool_result"]),
      );
    } finally {
      await cleanup(seeded);
    }
  });

  it("survives approval suspension, crash redelivery, resume, and final redelivery", async () => {
    const seeded = await seed("require_approval");
    try {
      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);
      await expect(loadRun(seeded)).resolves.toMatchObject({
        status: "awaiting_approval",
        checkpoint: {
          pendingCall: {
            toolCallId: "call-1",
            toolName: "counter.increment",
            args: { amount: 1 },
            argsHash: hashArgs({ amount: 1 }),
          },
        },
      });
      expect(destructiveCounter).toBe(0);

      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);
      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "awaiting_approval" });
      await expect(approvalRows(seeded)).resolves.toHaveLength(1);
      expect(destructiveCounter).toBe(0);

      await setDecision(seeded, "approved");
      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);
      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "done", checkpoint: null });
      expect(destructiveCounter).toBe(1);

      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);
      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "done" });
      expect(destructiveCounter).toBe(1);
    } finally {
      await cleanup(seeded);
    }
  });

  it("returns a denied approval decision to the model without executing the tool", async () => {
    const seeded = await seed("require_approval");
    try {
      const observedMessages: Parameters<AgentTurnFn>[0]["messages"][] = [];
      const observingTurn: AgentTurnFn = async function* (args) {
        observedMessages.push(args.messages);
        yield* scriptedTurn(args);
      };

      await executeRunWithTools(seeded.db, seeded.runId, observingTurn, [counterTool]);
      await setDecision(seeded, "denied");
      await executeRunWithTools(seeded.db, seeded.runId, observingTurn, [counterTool]);

      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "done", checkpoint: null });
      expect(destructiveCounter).toBe(0);
      expect(observedMessages.at(-1)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "tool",
            content: expect.arrayContaining([
              expect.objectContaining({
                type: "tool-result",
                output: expect.objectContaining({ value: "denied by user" }),
              }),
            ]),
          }),
        ]),
      );
    } finally {
      await cleanup(seeded);
    }
  });

  it("executes an approved side effect exactly once under concurrent duplicate delivery", async () => {
    const seeded = await seed("require_approval");
    try {
      await executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]);
      await setDecision(seeded, "approved");

      await Promise.all([
        executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]),
        executeRunWithTools(seeded.db, seeded.runId, scriptedTurn, [counterTool]),
      ]);

      await expect(loadRun(seeded)).resolves.toMatchObject({ status: "done" });
      expect(destructiveCounter).toBe(1);
      const invocations = await seeded.db.query.toolInvocations.findMany({
        where: (table, { eq }) => eq(table.runId, seeded.runId),
      });
      expect(invocations).toHaveLength(1);
    } finally {
      await cleanup(seeded);
    }
  });
});
