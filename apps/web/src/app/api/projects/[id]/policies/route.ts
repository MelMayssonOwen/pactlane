import { policies, type PolicyEffect } from "@pactlane/db";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPolicyEffect(value: unknown): value is PolicyEffect {
  return value === "allow" || value === "deny" || value === "require_approval";
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  return NextResponse.json(
    await db.query.policies.findMany({
      where: (policies, { eq }) => eq(policies.projectId, id),
      orderBy: (policies, { desc }) => [desc(policies.priority), desc(policies.createdAt)],
    }),
  );
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

  if (
    !isRecord(body) ||
    typeof body.toolMatch !== "string" ||
    body.toolMatch.trim().length === 0 ||
    !isPolicyEffect(body.effect) ||
    (body.priority !== undefined &&
      (typeof body.priority !== "number" || !Number.isInteger(body.priority)))
  ) {
    return NextResponse.json(
      { error: "toolMatch, effect, and optional integer priority required" },
      { status: 400 },
    );
  }

  const [policy] = await db
    .insert(policies)
    .values({
      projectId: id,
      toolMatch: body.toolMatch.trim(),
      effect: body.effect,
      ...(body.priority === undefined ? {} : { priority: body.priority }),
    })
    .returning();

  return NextResponse.json(policy);
}
