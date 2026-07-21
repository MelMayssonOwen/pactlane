import { describe, expect, it } from "vitest";
import { appendEvent, createDb, agents, projects, runs, runEvents } from "./index.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("db roundtrip", () => {
  it("creates project → agent → run and appends gap-free events", async () => {
    const db = createDb(url!);
    const [p] = await db.insert(projects).values({ name: "t" }).returning();
    const [a] = await db
      .insert(agents)
      .values({ projectId: p.id, name: "a", provider: "openai-compatible", model: "llama3.1" })
      .returning();
    const [r] = await db.insert(runs).values({ projectId: p.id, agentId: a.id, input: "hi" }).returning();
    const seqs = await Promise.all([1, 2, 3, 4, 5].map(() => appendEvent(db, r.id, "text", { t: "x" })));
    expect([...seqs].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5]);
    const rows = await db.select().from(runEvents);
    expect(rows.filter((e) => e.runId === r.id)).toHaveLength(5);
  });
});
