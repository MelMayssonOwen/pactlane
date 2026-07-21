import { NextResponse } from "next/server";
import { runs, eq } from "@pactlane/db";
import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [run] = await db.select().from(runs).where(eq(runs.id, id));
  if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(run);
}
