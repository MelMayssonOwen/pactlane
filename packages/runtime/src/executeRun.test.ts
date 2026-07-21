import { describe, expect, it } from "vitest";
import { createDb, agents, projects, runs, runEvents } from "@pactlane/db";
import { executeRun, type StreamFn } from "./executeRun.js";

const url = process.env.DATABASE_URL;

async function seed(db: ReturnType<typeof createDb>) {
  const [p] = await db.insert(projects).values({ name: "t" }).returning();
  const [a] = await db
    .insert(agents)
    .values({ projectId: p.id, name: "a", provider: "openai-compatible", model: "m", systemPrompt: "sys" })
    .returning();
  const [r] = await db.insert(runs).values({ projectId: p.id, agentId: a.id, input: "2+2?" }).returning();
  return r;
}

describe.skipIf(!url)("executeRun", () => {
  it("streams chunks into run_events and finishes done", async () => {
    const db = createDb(url!);
    const r = await seed(db);
    const fake: StreamFn = async function* () {
      yield "4";
      yield "!";
    };
    await executeRun(db, r.id, fake);
    const run = await db.query.runs.findFirst({
      where: (table, { eq }) => eq(table.id, r.id),
    });
    expect(run?.status).toBe("done");
    const evs = await db.query.runEvents.findMany({
      where: (table, { eq }) => eq(table.runId, r.id),
      orderBy: (table, { asc }) => [asc(table.seq)],
    });
    expect(evs.map((e) => e.type)).toEqual(["status", "text", "text", "status"]);
    expect(evs[1].payload).toEqual({ text: "4" });
  });

  it("marks failed and records error event when the stream throws", async () => {
    const db = createDb(url!);
    const r = await seed(db);
    const boom: StreamFn = async function* () {
      yield "partial";
      throw new Error("provider down");
    };
    await executeRun(db, r.id, boom);
    const run = await db.query.runs.findFirst({
      where: (table, { eq }) => eq(table.id, r.id),
    });
    expect(run?.status).toBe("failed");
    expect(run?.error).toContain("provider down");
  });
});
