import { afterEach, describe, expect, it, vi } from "vitest";
import { agents, approvals, createDb, projects, runs } from "@pactlane/db";

const { send } = vi.hoisted(() => ({
  send: vi.fn(async () => "job-1"),
}));

vi.mock("@/lib/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(async () => ({ user: { id: "reviewer-1", email: "reviewer@example.com" } })),
    },
  },
}));

vi.mock("@/lib/boss", () => ({
  getBoss: vi.fn(async () => ({ send })),
  RUN_EXECUTE: "run.execute",
}));

const url = process.env.DATABASE_URL;
const suiteName = url
  ? "approvals API"
  : "approvals API (skipped: DATABASE_URL is not set)";

describe.skipIf(!url)(suiteName, () => {
  afterEach(() => {
    send.mockClear();
  });

  it("lists a pending approval and decides it once before resuming the run", async () => {
    const db = createDb(url!);
    const [project] = await db
      .insert(projects)
      .values({ name: "Approvals API project" })
      .returning();

    try {
      const [agent] = await db
        .insert(agents)
        .values({
          projectId: project.id,
          name: "Approvals API agent",
          provider: "openai-compatible",
          model: "test-model",
        })
        .returning();
      const [run] = await db
        .insert(runs)
        .values({
          projectId: project.id,
          agentId: agent.id,
          input: "Fetch the release notes",
          status: "awaiting_approval",
        })
        .returning();
      const [approval] = await db
        .insert(approvals)
        .values({
          runId: run.id,
          toolCallId: "call-1",
          toolName: "http.fetch",
          args: { url: "https://example.com" },
          argsHash: "hash-1",
        })
        .returning();

      const [{ GET }, { POST }] = await Promise.all([
        import("./approvals/route"),
        import("./approvals/[id]/route"),
      ]);

      const inboxResponse = await GET();
      expect(inboxResponse.status).toBe(200);
      const inbox = (await inboxResponse.json()) as Array<{
        id: string;
        run: { id: string; input: string };
        project: { id: string; name: string };
      }>;
      expect(inbox).toContainEqual(
        expect.objectContaining({
          id: approval.id,
          run: { id: run.id, input: run.input },
          project: { id: project.id, name: project.name },
        }),
      );

      const decideResponse = await POST(
        new Request(`http://x/api/approvals/${approval.id}`, {
          method: "POST",
          body: JSON.stringify({ decision: "approved" }),
        }),
        { params: Promise.resolve({ id: approval.id }) },
      );
      expect(decideResponse.status).toBe(200);
      expect(await decideResponse.json()).toEqual(
        expect.objectContaining({
          id: approval.id,
          status: "approved",
          decidedBy: "reviewer-1",
        }),
      );

      const persisted = await db.query.approvals.findFirst({
        where: (approvals, { eq }) => eq(approvals.id, approval.id),
      });
      expect(persisted).toBeDefined();
      if (!persisted) throw new Error("approval was not persisted");
      expect(persisted.status).toBe("approved");
      expect(persisted.decidedAt).toBeInstanceOf(Date);
      expect(send).toHaveBeenCalledOnce();
      expect(send).toHaveBeenCalledWith("run.execute", { runId: run.id });

      const secondResponse = await POST(
        new Request(`http://x/api/approvals/${approval.id}`, {
          method: "POST",
          body: JSON.stringify({ decision: "denied" }),
        }),
        { params: Promise.resolve({ id: approval.id }) },
      );
      expect(secondResponse.status).toBe(409);
      expect(send).toHaveBeenCalledOnce();
    } finally {
      await db.$client.query("delete from projects where id = $1", [project.id]);
    }
  });
});
