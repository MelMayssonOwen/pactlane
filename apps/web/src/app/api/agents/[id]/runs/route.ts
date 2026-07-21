import { NextResponse } from "next/server";
import { runs } from "@pactlane/db";
import { db } from "@/lib/db";
import { getBoss, RUN_EXECUTE } from "@/lib/boss";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { input } = await req.json();
  if (!input) return NextResponse.json({ error: "input required" }, { status: 400 });
  const agent = await db.query.agents.findFirst({
    where: (agents, { eq }) => eq(agents.id, id),
  });
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });
  const [run] = await db.insert(runs).values({ projectId: agent.projectId, agentId: agent.id, input }).returning();
  await (await getBoss()).send(RUN_EXECUTE, { runId: run.id });
  return NextResponse.json(run);
}
