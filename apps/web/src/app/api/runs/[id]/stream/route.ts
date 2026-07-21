import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = 0;
      for (let i = 0; i < 1200; i++) {
        const evs = await db.query.runEvents.findMany({
          where: (runEvents, { and, eq, gt }) =>
            and(eq(runEvents.runId, id), gt(runEvents.seq, last)),
          orderBy: (runEvents, { asc }) => [asc(runEvents.seq)],
        });
        for (const e of evs) {
          last = e.seq;
          controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: e.type, payload: e.payload })}\n\n`));
          const p = e.payload as { status?: string };
          if (e.type === "status" && (p.status === "done" || p.status === "failed")) {
            controller.close();
            return;
          }
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
