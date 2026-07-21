import { describe, expect, it } from "vitest";
import { createDb, agents, projects, runs } from "@pactlane/db";
import type { AgentTurnFn } from "@pactlane/runtime";
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

    let observedToolNames: string[] = [];
    const fake: AgentTurnFn = async function* ({ tools }) {
      observedToolNames = tools.map((tool) => tool.name);
      yield { type: "text", text: "ok" };
      yield { type: "finish" };
    };
    const boss = await startWorker({ connectionString: url!, turn: fake });

    let status = "";
    try {
      await boss.send(RUN_EXECUTE, { runId: r.id });

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        const row = await db.query.runs.findFirst({
          where: (table, { eq }) => eq(table.id, r.id),
        });
        status = row?.status ?? "";
        if (status === "done" || status === "failed") break;
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    } finally {
      await boss.stop({ graceful: false });
      await db.$client.query("delete from projects where id = $1", [p.id]);
      await db.$client.end();
    }

    expect(status).toBe("done");
    expect(observedToolNames).toEqual(["http.fetch"]);
  }, 20_000);
});
