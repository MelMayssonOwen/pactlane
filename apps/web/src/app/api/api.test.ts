import { describe, expect, it } from "vitest";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("api handlers (requires DATABASE_URL)", () => {
  it("project → agent → run", async () => {
    const [{ POST: createProject }, { POST: createAgent }, { POST: createRun }] = await Promise.all([
      import("./projects/route"),
      import("./projects/[id]/agents/route"),
      import("./agents/[id]/runs/route"),
    ]);
    const p = await (
      await createProject(new Request("http://x/api/projects", { method: "POST", body: JSON.stringify({ name: "t" }) }))
    ).json();
    expect(p.id).toBeTruthy();
    const a = await (
      await createAgent(
        new Request("http://x", { method: "POST", body: JSON.stringify({ name: "a", provider: "openai-compatible", model: "m" }) }),
        { params: Promise.resolve({ id: p.id }) },
      )
    ).json();
    const r = await (
      await createRun(
        new Request("http://x", { method: "POST", body: JSON.stringify({ input: "hi" }) }),
        { params: Promise.resolve({ id: a.id }) },
      )
    ).json();
    expect(r.status).toBe("queued");
  });
});
