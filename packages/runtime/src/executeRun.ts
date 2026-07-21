import { appendEvent, runs, type Db } from "@pactlane/db";
import type { ModelMessage, ToolResultPart } from "ai";
import { eq } from "drizzle-orm";
import { invokeTool, type InvokeResult } from "./executor.js";
import { hashArgs } from "./hash.js";
import { RunSuspended, type ToolDef } from "./tools.js";

export type StreamFn = (args: {
  system: string;
  prompt: string;
  provider: string;
  model: string;
}) => AsyncIterable<string>;

export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "finish" };

export type AgentTurnFn = (args: {
  system: string;
  messages: ModelMessage[];
  provider: string;
  model: string;
  tools: ToolDef[];
}) => AsyncIterable<TurnEvent>;

export type Checkpoint = {
  messages: ModelMessage[];
  pendingCall?: {
    toolCallId: string;
    toolName: string;
    args: unknown;
    argsHash: string;
  };
};

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

export async function executeRunWithTools(
  db: Db,
  runId: string,
  turn: AgentTurnFn,
  tools: ToolDef[],
): Promise<void> {
  try {
    const run = await db.query.runs.findFirst({
      where: (table, operators) => operators.eq(table.id, runId),
    });
    if (!run || (run.status !== "queued" && run.status !== "awaiting_approval")) return;

    const agent = await db.query.agents.findFirst({
      where: (table, operators) => operators.eq(table.id, run.agentId),
    });
    if (!agent) throw new Error(`agent not found: ${run.agentId}`);

    let checkpoint =
      (run.checkpoint as Checkpoint | null) ??
      ({ messages: [{ role: "user", content: run.input }] } satisfies Checkpoint);

    if (checkpoint.pendingCall) {
      const pendingCall = checkpoint.pendingCall;
      try {
        const result = await invokeTool(
          { db, runId, projectId: run.projectId },
          tools,
          pendingCall,
        );
        checkpoint = appendToolExchange(checkpoint, pendingCall, result);
        await persistCheckpoint(db, runId, checkpoint);
      } catch (error) {
        if (error instanceof RunSuspended) {
          await markAwaitingApproval(db, runId);
          return;
        }
        throw error;
      }
    }

    await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
    await appendEvent(db, runId, "status", { status: "running" });

    for (let iteration = 0; iteration < 8; iteration += 1) {
      let assistantText = "";
      const toolCalls: Array<{
        toolCallId: string;
        toolName: string;
        args: unknown;
      }> = [];

      for await (const event of turn({
        system: agent.systemPrompt,
        messages: checkpoint.messages,
        provider: agent.provider,
        model: agent.model,
        tools,
      })) {
        if (event.type === "text") {
          assistantText += event.text;
          await appendEvent(db, runId, "text", { text: event.text });
        } else if (event.type === "tool-call") {
          toolCalls.push(event);
        }
      }

      if (toolCalls.length === 0) {
        checkpoint.messages.push({ role: "assistant", content: assistantText });
        await db
          .update(runs)
          .set({ status: "done", checkpoint: null, finishedAt: new Date() })
          .where(eq(runs.id, runId));
        await appendEvent(db, runId, "status", { status: "done" });
        return;
      }

      for (const [callIndex, call] of toolCalls.entries()) {
        await appendEvent(db, runId, "tool_call", {
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
        });

        checkpoint = {
          messages: checkpoint.messages,
          pendingCall: { ...call, argsHash: hashArgs(call.args) },
        };
        await persistCheckpoint(db, runId, checkpoint);

        try {
          const result = await invokeTool(
            { db, runId, projectId: run.projectId },
            tools,
            call,
          );
          checkpoint = appendToolExchange(
            checkpoint,
            call,
            result,
            callIndex === 0 ? assistantText : "",
          );
          await persistCheckpoint(db, runId, checkpoint);
        } catch (error) {
          if (error instanceof RunSuspended) {
            await markAwaitingApproval(db, runId);
            return;
          }
          throw error;
        }
      }
    }

    await markFailed(db, runId, "max tool iterations");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    try {
      await markFailed(db, runId, message);
    } catch {
      // A database failure can prevent recording the terminal state, but the
      // runtime contract still does not leak execution errors to the worker.
    }
  }
}

function appendToolExchange(
  checkpoint: Checkpoint,
  call: { toolCallId: string; toolName: string; args: unknown },
  result: InvokeResult,
  assistantText = "",
): Checkpoint {
  const assistantMessage: ModelMessage = {
    role: "assistant",
    content: [
      ...(assistantText ? [{ type: "text" as const, text: assistantText }] : []),
      {
        type: "tool-call",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        input: call.args,
      },
    ],
  };
  const toolMessage: ModelMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: toModelOutput(result),
      },
    ],
  };
  return { messages: [...checkpoint.messages, assistantMessage, toolMessage] };
}

function toModelOutput(result: InvokeResult): ToolResultPart["output"] {
  if (!result.ok) return { type: "error-text", value: result.error };
  if (typeof result.result === "string") return { type: "text", value: result.result };

  const serialized = JSON.stringify(result.result);
  return {
    type: "json",
    value: serialized === undefined ? null : JSON.parse(serialized),
  };
}

async function persistCheckpoint(db: Db, runId: string, checkpoint: Checkpoint): Promise<void> {
  await db.update(runs).set({ checkpoint }).where(eq(runs.id, runId));
}

async function markAwaitingApproval(db: Db, runId: string): Promise<void> {
  await db.update(runs).set({ status: "awaiting_approval" }).where(eq(runs.id, runId));
  await appendEvent(db, runId, "status", { status: "awaiting_approval" });
}

async function markFailed(db: Db, runId: string, message: string): Promise<void> {
  await appendEvent(db, runId, "error", { message });
  await db
    .update(runs)
    .set({ status: "failed", error: message, finishedAt: new Date() })
    .where(eq(runs.id, runId));
  await appendEvent(db, runId, "status", { status: "failed" });
}
