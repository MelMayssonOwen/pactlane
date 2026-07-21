import {
  appendEvent,
  approvals,
  toolInvocations,
  type Db,
  type InvocationStatus,
} from "@pactlane/db";
import { sql } from "drizzle-orm";
import { hashArgs } from "./hash.js";
import { evaluatePolicy } from "./policy.js";
import { RunSuspended, type ToolDef } from "./tools.js";

export type ExecutorCtx = { db: Db; runId: string; projectId: string };
export type InvokeResult = { ok: true; result: unknown } | { ok: false; error: string };

type ToolCall = { toolCallId: string; toolName: string; args: unknown };

export async function invokeTool(
  ctx: ExecutorCtx,
  tools: ToolDef[],
  call: ToolCall,
): Promise<InvokeResult> {
  const existingInvocation = await ctx.db.query.toolInvocations.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.runId, ctx.runId), eq(table.toolCallId, call.toolCallId)),
  });
  if (existingInvocation) {
    if (existingInvocation.status === "executed") {
      return { ok: true, result: existingInvocation.result };
    }
    return {
      ok: false,
      error: storedError(existingInvocation.result, existingInvocation.status),
    };
  }

  const argsHash = hashArgs(call.args);
  const rules = await ctx.db.query.policies.findMany({
    where: (table, { and, eq }) =>
      and(eq(table.projectId, ctx.projectId), eq(table.enabled, true)),
  });
  const effect = evaluatePolicy(rules, call.toolName);

  await appendEvent(ctx.db, ctx.runId, "policy", {
    toolName: call.toolName,
    toolCallId: call.toolCallId,
    effect,
  });

  if (effect === "deny") {
    return recordError(ctx, call, argsHash, "denied", "denied by policy");
  }

  if (effect === "require_approval") {
    const existingApproval = await ctx.db.query.approvals.findFirst({
      where: (table, { and, eq }) =>
        and(eq(table.runId, ctx.runId), eq(table.toolCallId, call.toolCallId)),
    });

    if (!existingApproval) {
      const [approval] = await ctx.db
        .insert(approvals)
        .values({
          runId: ctx.runId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          args: call.args,
          argsHash,
        })
        .returning({ id: approvals.id });
      const approvalId = approval!.id;
      await appendEvent(ctx.db, ctx.runId, "approval_requested", {
        approvalId,
        toolName: call.toolName,
        toolCallId: call.toolCallId,
      });
      throw new RunSuspended(approvalId);
    }

    if (existingApproval.status === "pending") {
      throw new RunSuspended(existingApproval.id);
    }
    if (existingApproval.status === "denied") {
      return recordError(ctx, call, argsHash, "denied", "denied by user");
    }
    if (existingApproval.argsHash !== argsHash) {
      return recordError(ctx, call, argsHash, "failed", "frozen args mismatch");
    }
  }

  const tool = tools.find((candidate) => candidate.name === call.toolName);
  if (!tool) {
    return recordError(ctx, call, argsHash, "failed", "unknown tool");
  }

  const parsed = tool.inputSchema.safeParse(call.args);
  if (!parsed.success) {
    return recordError(ctx, call, argsHash, "failed", "invalid arguments");
  }

  // Exactly-once critical section: an advisory xact lock serializes concurrent
  // deliveries of the same tool call; the re-check inside the lock makes the
  // loser return the winner's stored outcome instead of re-executing.
  let outcome: InvokeResult;
  try {
    outcome = await ctx.db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`${ctx.runId}:${call.toolCallId}`}))`,
      );
      const winner = await tx.query.toolInvocations.findFirst({
        where: (table, { and, eq }) =>
          and(eq(table.runId, ctx.runId), eq(table.toolCallId, call.toolCallId)),
      });
      if (winner) {
        return winner.status === "executed"
          ? ({ ok: true, result: winner.result } as InvokeResult)
          : ({ ok: false, error: storedError(winner.result, winner.status) } as InvokeResult);
      }
      const result = await tool.execute(parsed.data);
      await tx.insert(toolInvocations).values({
        runId: ctx.runId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        argsHash,
        status: "executed",
        result,
      });
      return { ok: true, result } as InvokeResult;
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return recordError(ctx, call, argsHash, "failed", message);
  }
  if (outcome.ok) {
    await appendEvent(ctx.db, ctx.runId, "tool_result", {
      toolName: call.toolName,
      toolCallId: call.toolCallId,
      result: outcome.result,
    });
  }
  return outcome;
}

async function recordError(
  ctx: ExecutorCtx,
  call: ToolCall,
  argsHash: string,
  status: Exclude<InvocationStatus, "executed">,
  error: string,
): Promise<InvokeResult> {
  await ctx.db.insert(toolInvocations).values({
    runId: ctx.runId,
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    argsHash,
    status,
    result: { error },
  });
  return { ok: false, error };
}

function storedError(result: unknown, status: Exclude<InvocationStatus, "executed">): string {
  if (result && typeof result === "object" && "error" in result) {
    const error = (result as { error?: unknown }).error;
    if (typeof error === "string") return error;
  }
  if (typeof result === "string") return result;
  return status === "denied" ? "denied" : "tool invocation failed";
}
