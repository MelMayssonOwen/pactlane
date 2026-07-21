import type { ApprovalStatus } from "@pactlane/db";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getBoss, RUN_EXECUTE } from "@/lib/boss";
import { db } from "@/lib/db";

type Decision = Exclude<ApprovalStatus, "pending">;
type UpdatedApproval = {
  id: string;
  runId: string;
  toolCallId: string;
  toolName: string;
  args: unknown;
  argsHash: string;
  status: ApprovalStatus;
  decidedBy: string | null;
  decidedAt: Date | null;
  createdAt: Date;
};

function isDecision(value: unknown): value is Decision {
  return value === "approved" || value === "denied";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!isRecord(body) || !isDecision(body.decision)) {
    return NextResponse.json(
      { error: "decision must be approved or denied" },
      { status: 400 },
    );
  }

  const session = await auth.api.getSession({ headers: req.headers });
  const result = await db.$client.query<UpdatedApproval>(
    `update approvals
       set status = $1, decided_by = $2, decided_at = now()
     where id = $3 and status = 'pending'
     returning id,
       run_id as "runId",
       tool_call_id as "toolCallId",
       tool_name as "toolName",
       args,
       args_hash as "argsHash",
       status,
       decided_by as "decidedBy",
       decided_at as "decidedAt",
       created_at as "createdAt"`,
    [body.decision, session?.user.id ?? "unknown", id],
  );
  const [updated] = result.rows;

  if (!updated) {
    return NextResponse.json(
      { error: "approval has already been decided" },
      { status: 409 },
    );
  }

  await (await getBoss()).send(RUN_EXECUTE, { runId: updated.runId });
  return NextResponse.json(updated);
}
