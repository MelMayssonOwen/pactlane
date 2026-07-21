import { NextResponse } from "next/server";
import { projects } from "@pactlane/db";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const { name } = await req.json();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  const [p] = await db.insert(projects).values({ name }).returning();
  return NextResponse.json(p);
}
export async function GET() {
  return NextResponse.json(await db.select().from(projects));
}
