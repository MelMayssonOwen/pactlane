import { NextResponse } from "next/server";
import { agents } from "@pactlane/db";
import { db } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { name, provider, model, systemPrompt } = await req.json();
  if (!name || !provider || !model) return NextResponse.json({ error: "name, provider, model required" }, { status: 400 });
  const [a] = await db
    .insert(agents)
    .values({ projectId: id, name, provider, model, ...(systemPrompt ? { systemPrompt } : {}) })
    .returning();
  return NextResponse.json(a);
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(
    await db.query.agents.findMany({
      where: (agents, { eq }) => eq(agents.projectId, id),
    }),
  );
}
