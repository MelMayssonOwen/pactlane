import { describe, expect, it } from "vitest";
import { createDb, agents, projects, runs } from "@pactlane/db";
import type { StreamFn } from "@pactlane/runtime";
import { RUN_EXECUTE, startWorker } from "./queue.js";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("worker queue", () => {
  it("processes an enqueued run to done", async () => {
    const db = createDb(url!);
    const [p] = await db.insert(projects).values({ name: "t" }).returning();
    const [a] = await db
      .insert(agents)
      .values({ projectId: p.id, name: "a", provider: "openai-compatible", model: "m" })
      .returning();
    const [r] = await db.insert(runs).values({ projectId: p.id, agentId: a.id, input: "hi" }).returning();

    const fake: StreamFn = async function* () {
      yield "ok";
    };
    const boss = await startWorker({ connectionString: url!, stream: fake });
    await boss.send(RUN_EXECUTE, { runId: r.id });

    const deadline = Date.now() + 15_000;
    let status = "";
    while (Date.now() < deadline) {
      const row = await db.query.runs.findFirst({ where: (table, { eq }) => eq(table.id, r.id) });
      status = row?.status ?? "";
      if (status === "done" || status === "failed") break;
      await new Promise((res) => setTimeout(res, 250));
    }
    await boss.stop({ graceful: false });
    expect(status).toBe("done");
  }, 20_000);
});
