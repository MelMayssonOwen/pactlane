import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET() {
  const approvals = await db.query.approvals.findMany({
    where: (approvals, { eq }) => eq(approvals.status, "pending"),
    orderBy: (approvals, { asc }) => [asc(approvals.createdAt)],
  });
  const pending = await Promise.all(
    approvals.map(async (approval) => {
      const run = await db.query.runs.findFirst({
        where: (runs, { eq }) => eq(runs.id, approval.runId),
      });
      if (!run) return null;
      const project = await db.query.projects.findFirst({
        where: (projects, { eq }) => eq(projects.id, run.projectId),
      });
      if (!project) return null;

      return {
        ...approval,
        run: { id: run.id, input: run.input },
        project: { id: project.id, name: project.name },
      };
    }),
  );

  return NextResponse.json(pending.filter((approval) => approval !== null));
}
