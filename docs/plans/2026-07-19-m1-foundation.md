# M1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docker compose up` → sign up → create a project and an agent → start a run → watch the agent's answer stream live, with every event durable in Postgres and local LLMs usable via an OpenAI-compatible baseURL.

**Architecture:** pnpm monorepo. `packages/db` (Drizzle + Postgres) is the single store. `packages/runtime` runs one agent turn as a pure function with an injectable stream function (AI SDK behind it). `apps/worker` consumes `run.execute` jobs via pg-boss. `apps/web` (Next.js + Better Auth) creates entities, enqueues runs, and serves an SSE tail of `run_events`. See `ARCHITECTURE.md` for the full v0 picture; M1 deliberately contains **no tool calls and no policies** (that's M2).

**Tech Stack:** TypeScript (strict), pnpm workspaces, Node 22, Next.js 15 (App Router), Drizzle ORM + node-postgres, pg-boss v10, Better Auth, AI SDK v5 (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`), Vitest, Docker Compose.

## Global Constraints

- Repo is PUBLIC. Never commit credentials or `.env` (only `.env.example`). Never commit AI working notes (`.gitignore` enforces).
- License MIT; no proprietary cloud dependencies (no Auth0/Supabase/hosted queues).
- Every provider path must accept a custom `baseURL` so local LLMs (Ollama/vLLM/llama-server) work.
- `"strict": true` TypeScript everywhere; no `any` in exported signatures.
- Every commit message ends with trailer line: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Tests requiring Postgres use `DATABASE_URL` and must be skipped-with-message when it is unset, never red.
- Package manager is pnpm; never npm/yarn.

---

### Task 1: Monorepo scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`, `.env.example`
- Create: `packages/db/package.json`, `packages/runtime/package.json`, `apps/worker/package.json`, `apps/web/package.json` (placeholder `{}` bodies filled by later tasks are NOT allowed — full content below)

**Interfaces:**
- Produces: workspace layout `packages/db` → `@pactlane/db`, `packages/runtime` → `@pactlane/runtime`, importable from apps; shared `tsconfig.base.json`.

- [ ] **Step 1: Write root files**

`package.json`:
```json
{
  "name": "pactlane",
  "private": true,
  "engines": { "node": ">=22" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -b packages/db packages/runtime apps/worker"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "vitest": "^3.0.0"
  },
  "packageManager": "pnpm@10.0.0"
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "apps/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": true,
    "sourceMap": true
  }
}
```

`vitest.workspace.ts`:
```ts
export default ["packages/*", "apps/worker"];
```

`.env.example`:
```bash
DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane
BETTER_AUTH_SECRET=change-me-32-chars-minimum-secret
BETTER_AUTH_URL=http://localhost:3000
# Providers — set any subset; local LLMs need no key
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
OPENAI_COMPATIBLE_BASE_URL=http://localhost:11434/v1
```

`packages/db/package.json`:
```json
{
  "name": "@pactlane/db",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run", "generate": "drizzle-kit generate", "migrate": "drizzle-kit migrate" },
  "dependencies": { "drizzle-orm": "^0.44.0", "pg": "^8.13.0" },
  "devDependencies": { "drizzle-kit": "^0.31.0", "@types/pg": "^8.11.0", "vitest": "^3.0.0", "typescript": "^5.5.0" }
}
```

`packages/runtime/package.json`:
```json
{
  "name": "@pactlane/runtime",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@pactlane/db": "workspace:*",
    "ai": "^5.0.0",
    "@ai-sdk/anthropic": "^2.0.0",
    "@ai-sdk/openai": "^2.0.0",
    "@ai-sdk/openai-compatible": "^1.0.0"
  },
  "devDependencies": { "vitest": "^3.0.0", "typescript": "^5.5.0" }
}
```

`apps/worker/package.json`:
```json
{
  "name": "@pactlane/worker",
  "version": "0.0.1",
  "type": "module",
  "main": "src/index.ts",
  "scripts": { "start": "node --experimental-strip-types src/index.ts", "test": "vitest run" },
  "dependencies": { "@pactlane/db": "workspace:*", "@pactlane/runtime": "workspace:*", "pg-boss": "^10.1.0" },
  "devDependencies": { "vitest": "^3.0.0", "typescript": "^5.5.0" }
}
```

`apps/web/package.json` (dependencies land in Task 6; scaffold must parse):
```json
{
  "name": "@pactlane/web",
  "version": "0.0.1",
  "private": true,
  "scripts": { "dev": "next dev", "build": "next build", "start": "next start" }
}
```

- [ ] **Step 2: Write a workspace smoke test**

`packages/db/src/smoke.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("workspace", () => {
  it("runs tests", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Install and run**

Run: `pnpm install && pnpm test`
Expected: 1 test file, 1 passed.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: pnpm monorepo scaffold (db, runtime, worker, web)" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Postgres + core schema

**Files:**
- Create: `docker-compose.yml` (db service only for now), `packages/db/drizzle.config.ts`, `packages/db/src/schema.ts`, `packages/db/src/client.ts`, `packages/db/src/events.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/schema.test.ts`

**Interfaces:**
- Produces:
  - `createDb(connectionString: string): Db` and type `Db` (drizzle node-postgres instance with schema)
  - tables `projects`, `agents`, `runs`, `runEvents` exported from `@pactlane/db`
  - `appendEvent(db: Db, runId: string, type: string, payload: unknown): Promise<number>` — returns the assigned `seq`, gap-free per run
  - `RunStatus = "queued" | "running" | "done" | "failed"` (M2 adds `awaiting_approval`)

- [ ] **Step 1: Compose db service**

`docker-compose.yml`:
```yaml
services:
  db:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: pactlane
      POSTGRES_PASSWORD: pactlane
      POSTGRES_DB: pactlane
    ports: ["5432:5432"]
    volumes: [dbdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U pactlane"]
      interval: 2s
      retries: 20
volumes:
  dbdata:
```

Run: `docker compose up -d db && docker compose ps`
Expected: db healthy.

- [ ] **Step 2: Schema**

`packages/db/src/schema.ts`:
```ts
import { pgTable, text, uuid, timestamp, integer, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  systemPrompt: text("system_prompt").notNull().default("You are a helpful agent."),
  provider: text("provider").notNull(), // "anthropic" | "openai" | "openai-compatible"
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RunStatus = "queued" | "running" | "done" | "failed";

export const runs = pgTable("runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  status: text("status").$type<RunStatus>().notNull().default("queued"),
  input: text("input").notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export const runEvents = pgTable(
  "run_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    type: text("type").notNull(), // "status" | "text" | "error"
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("run_events_run_seq").on(t.runId, t.seq)],
);
```

`packages/db/src/client.ts`:
```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const pool = new pg.Pool({ connectionString });
  return drizzle(pool, { schema });
}
export type Db = ReturnType<typeof createDb>;
```

`packages/db/src/events.ts` (serialized per run via advisory lock → gap-free seq):
```ts
import { sql } from "drizzle-orm";
import type { Db } from "./client.js";
import { runEvents } from "./schema.js";

export async function appendEvent(db: Db, runId: string, type: string, payload: unknown): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${runId}))`);
    const [{ next }] = (
      await tx.execute<{ next: number }>(
        sql`select coalesce(max(seq), 0) + 1 as next from run_events where run_id = ${runId}`,
      )
    ).rows;
    await tx.insert(runEvents).values({ runId, seq: next, type, payload });
    return next;
  });
}
```

`packages/db/src/index.ts`:
```ts
export * from "./schema.js";
export * from "./client.js";
export * from "./events.js";
```

`packages/db/drizzle.config.ts`:
```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://pactlane:pactlane@localhost:5432/pactlane" },
});
```

- [ ] **Step 3: Write the failing test**

`packages/db/src/schema.test.ts`:
```ts
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
```

- [ ] **Step 4: Run test to verify it fails**

Run: `export DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane && pnpm --filter @pactlane/db test`
Expected: FAIL — relations do not exist (no migration yet).

- [ ] **Step 5: Generate + run migration, re-run test**

Run: `pnpm --filter @pactlane/db generate && DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/db migrate && DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/db test`
Expected: PASS (commit the generated `packages/db/drizzle/` directory).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(db): core schema (projects, agents, runs, run_events) + gap-free appendEvent" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Runtime — executeRun with injectable stream

**Files:**
- Create: `packages/runtime/src/executeRun.ts`, `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/executeRun.test.ts`

**Interfaces:**
- Consumes: `Db`, `appendEvent`, `runs`, `agents` from `@pactlane/db`.
- Produces:
  - `type StreamFn = (args: { system: string; prompt: string; provider: string; model: string }) => AsyncIterable<string>`
  - `executeRun(db: Db, runId: string, stream: StreamFn): Promise<void>` — status `queued→running→done|failed`, emits `status` events, `text` events per chunk, `error` event + `failed` status on throw. Never throws.

- [ ] **Step 1: Write the failing test**

`packages/runtime/src/executeRun.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createDb, agents, projects, runs, runEvents } from "@pactlane/db";
import { eq, asc } from "drizzle-orm";
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
    const [run] = await db.select().from(runs).where(eq(runs.id, r.id));
    expect(run.status).toBe("done");
    const evs = await db.select().from(runEvents).where(eq(runEvents.runId, r.id)).orderBy(asc(runEvents.seq));
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
    const [run] = await db.select().from(runs).where(eq(runs.id, r.id));
    expect(run.status).toBe("failed");
    expect(run.error).toContain("provider down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/runtime test`
Expected: FAIL — `executeRun.js` not found.

- [ ] **Step 3: Implement**

`packages/runtime/src/executeRun.ts`:
```ts
import { eq } from "drizzle-orm";
import { appendEvent, agents, runs, type Db } from "@pactlane/db";

export type StreamFn = (args: {
  system: string;
  prompt: string;
  provider: string;
  model: string;
}) => AsyncIterable<string>;

export async function executeRun(db: Db, runId: string, stream: StreamFn): Promise<void> {
  const [run] = await db.select().from(runs).where(eq(runs.id, runId));
  if (!run || run.status !== "queued") return; // idempotent re-delivery guard
  const [agent] = await db.select().from(agents).where(eq(agents.id, run.agentId));
  try {
    await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
    await appendEvent(db, runId, "status", { status: "running" });
    for await (const text of stream({
      system: agent.systemPrompt,
      prompt: run.input,
      provider: agent.provider,
      model: agent.model,
    })) {
      await appendEvent(db, runId, "text", { text });
    }
    await db.update(runs).set({ status: "done", finishedAt: new Date() }).where(eq(runs.id, runId));
    await appendEvent(db, runId, "status", { status: "done" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await appendEvent(db, runId, "error", { message });
    await db.update(runs).set({ status: "failed", error: message, finishedAt: new Date() }).where(eq(runs.id, runId));
    await appendEvent(db, runId, "status", { status: "failed" });
  }
}
```

`packages/runtime/src/index.ts`:
```ts
export * from "./executeRun.js";
export * from "./providers.js"; // added in Task 4 — omit this line until then
```

(For this task, `index.ts` contains only the first export line.)

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/runtime test`
Expected: 2 passed.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): executeRun state machine with injectable stream" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Providers — real StreamFn incl. local LLMs

**Files:**
- Create: `packages/runtime/src/providers.ts`
- Modify: `packages/runtime/src/index.ts` (add `export * from "./providers.js";`)
- Test: `packages/runtime/src/providers.test.ts`

**Interfaces:**
- Produces:
  - `resolveModel(provider: string, model: string): LanguageModel` — `"anthropic"` → `@ai-sdk/anthropic`, `"openai"` → `@ai-sdk/openai`, `"openai-compatible"` → `@ai-sdk/openai-compatible` with `baseURL` from `OPENAI_COMPATIBLE_BASE_URL` (default `http://localhost:11434/v1`, i.e. Ollama). Unknown provider throws.
  - `aiStream: StreamFn` — wraps AI SDK `streamText`, yields text chunks.

- [ ] **Step 1: Write the failing test**

`packages/runtime/src/providers.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveModel } from "./providers.js";

describe("resolveModel", () => {
  it("maps all three provider families", () => {
    expect(resolveModel("anthropic", "claude-sonnet-5").modelId).toBe("claude-sonnet-5");
    expect(resolveModel("openai", "gpt-5.2").modelId).toBe("gpt-5.2");
    expect(resolveModel("openai-compatible", "llama3.1").modelId).toBe("llama3.1");
  });

  it("throws on unknown provider", () => {
    expect(() => resolveModel("nope", "x")).toThrow(/unknown provider/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @pactlane/runtime test`
Expected: FAIL — `providers.js` not found.

- [ ] **Step 3: Implement**

`packages/runtime/src/providers.ts`:
```ts
import { streamText, type LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { StreamFn } from "./executeRun.js";

export function resolveModel(provider: string, model: string): LanguageModel {
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? "" })(model);
    case "openai":
      return createOpenAI({ apiKey: process.env.OPENAI_API_KEY ?? "" })(model);
    case "openai-compatible":
      return createOpenAICompatible({
        name: "local",
        baseURL: process.env.OPENAI_COMPATIBLE_BASE_URL ?? "http://localhost:11434/v1",
        apiKey: process.env.OPENAI_COMPATIBLE_API_KEY ?? "local",
      })(model);
    default:
      throw new Error(`unknown provider: ${provider}`);
  }
}

export const aiStream: StreamFn = ({ system, prompt, provider, model }) => {
  const result = streamText({ model: resolveModel(provider, model), system, prompt });
  return result.textStream;
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @pactlane/runtime test`
Expected: all passed. (If AI SDK exposes `modelId` differently in the installed minor version, assert on the property the debugger shows — the intent is: correct model id reaches the provider object.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(runtime): provider resolution incl. OpenAI-compatible local LLMs" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Worker — pg-boss consumer

**Files:**
- Create: `apps/worker/src/index.ts`, `apps/worker/src/queue.ts`
- Test: `apps/worker/src/queue.test.ts`

**Interfaces:**
- Consumes: `executeRun`, `aiStream` from `@pactlane/runtime`; `createDb` from `@pactlane/db`.
- Produces:
  - Queue name constant `RUN_EXECUTE = "run.execute"`, payload `{ runId: string }` — the web app sends to this exact queue.
  - `startWorker(opts: { connectionString: string; stream?: StreamFn }): Promise<PgBoss>` — starts boss, ensures queue, registers handler.

- [ ] **Step 1: Write the failing test**

`apps/worker/src/queue.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createDb, agents, projects, runs } from "@pactlane/db";
import { eq } from "drizzle-orm";
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
      const [row] = await db.select().from(runs).where(eq(runs.id, r.id));
      status = row.status;
      if (status === "done" || status === "failed") break;
      await new Promise((res) => setTimeout(res, 250));
    }
    await boss.stop({ graceful: false });
    expect(status).toBe("done");
  }, 20_000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/worker test`
Expected: FAIL — `queue.js` not found.

- [ ] **Step 3: Implement**

`apps/worker/src/queue.ts`:
```ts
import PgBoss from "pg-boss";
import { createDb } from "@pactlane/db";
import { aiStream, executeRun, type StreamFn } from "@pactlane/runtime";

export const RUN_EXECUTE = "run.execute";

export async function startWorker(opts: { connectionString: string; stream?: StreamFn }): Promise<PgBoss> {
  const boss = new PgBoss(opts.connectionString);
  const db = createDb(opts.connectionString);
  const stream = opts.stream ?? aiStream;
  await boss.start();
  await boss.createQueue(RUN_EXECUTE);
  await boss.work<{ runId: string }>(RUN_EXECUTE, async (jobs) => {
    for (const job of jobs) {
      await executeRun(db, job.data.runId, stream);
    }
  });
  return boss;
}
```

`apps/worker/src/index.ts`:
```ts
import { startWorker } from "./queue.js";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
await startWorker({ connectionString: url });
console.log("[worker] listening on run.execute");
```

- [ ] **Step 4: Run test to verify it passes**

Run: `DATABASE_URL=postgres://pactlane:pactlane@localhost:5432/pactlane pnpm --filter @pactlane/worker test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(worker): pg-boss run.execute consumer" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Web app — Next.js + Better Auth

**Files:**
- Create: `apps/web` via `pnpm create next-app@latest apps/web --ts --app --no-tailwind --no-eslint --src-dir --import-alias "@/*"` then edit; keep the generated files plus:
- Create: `apps/web/src/lib/auth.ts`, `apps/web/src/lib/auth-client.ts`, `apps/web/src/lib/db.ts`, `apps/web/src/app/api/auth/[...all]/route.ts`, `apps/web/src/app/login/page.tsx`, `apps/web/src/middleware.ts`
- Modify: `apps/web/package.json` — add deps `@pactlane/db workspace:*`, `pg-boss ^10.1.0`, `better-auth ^1.3.0`, `drizzle-orm ^0.44.0`, `pg ^8.13.0`

**Interfaces:**
- Produces: `auth` (Better Auth server instance), `db` singleton (`apps/web/src/lib/db.ts`, exports `db: Db`), session-protected app routes; Better Auth's generated Drizzle schema appended to `packages/db/src/schema.ts` via `npx @better-auth/cli generate`.

- [ ] **Step 1: Scaffold and wire auth**

`apps/web/src/lib/db.ts`:
```ts
import { createDb } from "@pactlane/db";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL required");
export const db = createDb(url);
```

`apps/web/src/lib/auth.ts`:
```ts
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";

export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  emailAndPassword: { enabled: true },
});
```

`apps/web/src/app/api/auth/[...all]/route.ts`:
```ts
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "@/lib/auth";

export const { GET, POST } = toNextJsHandler(auth);
```

`apps/web/src/lib/auth-client.ts`:
```ts
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();
```

- [ ] **Step 2: Generate auth tables and migrate**

Run: `cd apps/web && npx @better-auth/cli@latest generate --config src/lib/auth.ts` — move/merge the generated Drizzle tables into `packages/db/src/schema.ts`, then `pnpm --filter @pactlane/db generate && DATABASE_URL=... pnpm --filter @pactlane/db migrate`.
Expected: `user`, `session`, `account`, `verification` tables exist.

- [ ] **Step 3: Login page + middleware**

`apps/web/src/app/login/page.tsx`:
```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function Login() {
  const r = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  async function go(mode: "in" | "up") {
    const fn = mode === "in" ? authClient.signIn.email : authClient.signUp.email;
    const res = await fn({ email, password, name: email.split("@")[0] });
    if (res.error) setErr(res.error.message ?? "failed");
    else r.push("/");
  }
  return (
    <main style={{ maxWidth: 360, margin: "10vh auto", display: "grid", gap: 8 }}>
      <h1>pactlane</h1>
      <input placeholder="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button onClick={() => go("in")}>Sign in</button>
      <button onClick={() => go("up")}>Sign up</button>
      {err && <p style={{ color: "red" }}>{err}</p>}
    </main>
  );
}
```

`apps/web/src/middleware.ts`:
```ts
import { NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const hasSession = req.cookies.getAll().some((c) => c.name.includes("session_token"));
  if (!hasSession && req.nextUrl.pathname !== "/login") {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ["/((?!api/auth|_next|favicon.ico).*)"] };
```

- [ ] **Step 4: Manual verify**

Run: `DATABASE_URL=... BETTER_AUTH_SECRET=dev-secret-32-chars-xxxxxxxxxxxxx pnpm --filter @pactlane/web dev`
Expected: visiting `http://localhost:3000` redirects to `/login`; sign-up then lands on `/`; `user` row exists in Postgres.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(web): Next.js app with Better Auth email/password" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Web — projects/agents/runs API + SSE + chat page

**Files:**
- Create: `apps/web/src/lib/boss.ts`, `apps/web/src/app/api/projects/route.ts`, `apps/web/src/app/api/projects/[id]/agents/route.ts`, `apps/web/src/app/api/agents/[id]/runs/route.ts`, `apps/web/src/app/api/runs/[id]/stream/route.ts`, `apps/web/src/app/page.tsx`, `apps/web/src/app/projects/[id]/page.tsx`
- Test: `apps/web/src/app/api/api.test.ts` (route handlers invoked directly; add `"test": "vitest run"` script + vitest devDep to `apps/web/package.json` and `"apps/web"` to `vitest.workspace.ts`)

**Interfaces:**
- Consumes: `RUN_EXECUTE` queue name (string literal `"run.execute"` — keep identical to Task 5), `db`, tables from `@pactlane/db`.
- Produces: REST surface —
  - `POST /api/projects` `{name}` → project JSON
  - `POST /api/projects/:id/agents` `{name, provider, model, systemPrompt?}` → agent JSON
  - `POST /api/agents/:id/runs` `{input}` → run JSON (enqueues `run.execute`)
  - `GET /api/runs/:id/stream` → `text/event-stream`, one SSE `data:` line per run_event, closes after terminal `status`.

- [ ] **Step 1: boss singleton**

`apps/web/src/lib/boss.ts`:
```ts
import PgBoss from "pg-boss";

export const RUN_EXECUTE = "run.execute";
let boss: PgBoss | null = null;

export async function getBoss(): Promise<PgBoss> {
  if (!boss) {
    boss = new PgBoss(process.env.DATABASE_URL!);
    await boss.start();
    await boss.createQueue(RUN_EXECUTE);
  }
  return boss;
}
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/app/api/api.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { POST as createProject } from "./projects/route";
import { POST as createAgent } from "./projects/[id]/agents/route";
import { POST as createRun } from "./agents/[id]/runs/route";

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("api handlers", () => {
  it("project → agent → run", async () => {
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `DATABASE_URL=... pnpm --filter @pactlane/web test`
Expected: FAIL — route modules not found.

- [ ] **Step 4: Implement routes**

`apps/web/src/app/api/projects/route.ts`:
```ts
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
```

`apps/web/src/app/api/projects/[id]/agents/route.ts`:
```ts
import { NextResponse } from "next/server";
import { agents } from "@pactlane/db";
import { db } from "@/lib/db";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { name, provider, model, systemPrompt } = await req.json();
  if (!name || !provider || !model) return NextResponse.json({ error: "name, provider, model required" }, { status: 400 });
  const [a] = await db
    .insert(agents)
    .values({ projectId: id, name, provider, model, ...(systemPrompt ? { systemPrompt } : {}) })
    .returning();
  return NextResponse.json(a);
}
```

`apps/web/src/app/api/agents/[id]/runs/route.ts`:
```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { agents, runs } from "@pactlane/db";
import { db } from "@/lib/db";
import { getBoss, RUN_EXECUTE } from "@/lib/boss";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { input } = await req.json();
  if (!input) return NextResponse.json({ error: "input required" }, { status: 400 });
  const [agent] = await db.select().from(agents).where(eq(agents.id, id));
  if (!agent) return NextResponse.json({ error: "agent not found" }, { status: 404 });
  const [run] = await db.insert(runs).values({ projectId: agent.projectId, agentId: agent.id, input }).returning();
  await (await getBoss()).send(RUN_EXECUTE, { runId: run.id });
  return NextResponse.json(run);
}
```

`apps/web/src/app/api/runs/[id]/stream/route.ts`:
```ts
import { asc, eq, gt, and } from "drizzle-orm";
import { runEvents } from "@pactlane/db";
import { db } from "@/lib/db";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let last = 0;
      for (let i = 0; i < 1200; i++) {
        const evs = await db
          .select()
          .from(runEvents)
          .where(and(eq(runEvents.runId, id), gt(runEvents.seq, last)))
          .orderBy(asc(runEvents.seq));
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `DATABASE_URL=... pnpm --filter @pactlane/web test`
Expected: PASS.

- [ ] **Step 6: Minimal UI**

`apps/web/src/app/page.tsx` (server component):
```tsx
import Link from "next/link";
import { projects } from "@pactlane/db";
import { db } from "@/lib/db";

export default async function Home() {
  const list = await db.select().from(projects);
  return (
    <main style={{ maxWidth: 640, margin: "5vh auto", display: "grid", gap: 12 }}>
      <h1>Projects</h1>
      <form
        action={async (fd: FormData) => {
          "use server";
          await db.insert(projects).values({ name: String(fd.get("name")) });
        }}
      >
        <input name="name" placeholder="new project name" required /> <button>Create</button>
      </form>
      <ul>
        {list.map((p) => (
          <li key={p.id}>
            <Link href={`/projects/${p.id}`}>{p.name}</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
```

`apps/web/src/app/projects/[id]/page.tsx` (client page: create agent form → POST `/api/projects/:id/agents`; run form → POST `/api/agents/:id/runs`; then `new EventSource('/api/runs/' + run.id + '/stream')` appending `payload.text` chunks to a `<pre>`; render agents list fetched from a small `GET` you add beside the agents `POST`):
```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Agent = { id: string; name: string; provider: string; model: string };

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [sel, setSel] = useState("");
  const [input, setInput] = useState("");
  const [out, setOut] = useState("");
  const [form, setForm] = useState({ name: "", provider: "openai-compatible", model: "llama3.1" });

  const refresh = () =>
    fetch(`/api/projects/${id}/agents`).then((r) => r.json()).then(setAgents);
  useEffect(() => {
    void refresh();
  }, [id]);

  async function addAgent() {
    await fetch(`/api/projects/${id}/agents`, { method: "POST", body: JSON.stringify(form) });
    await refresh();
  }
  async function run() {
    setOut("");
    const r = await fetch(`/api/agents/${sel}/runs`, { method: "POST", body: JSON.stringify({ input }) });
    const { id: runId } = await r.json();
    const es = new EventSource(`/api/runs/${runId}/stream`);
    es.onmessage = (m) => {
      const { type, payload } = JSON.parse(m.data);
      if (type === "text") setOut((o) => o + payload.text);
      if (type === "status" && ["done", "failed"].includes(payload.status)) es.close();
    };
  }

  return (
    <main style={{ maxWidth: 640, margin: "5vh auto", display: "grid", gap: 12 }}>
      <h1>Project</h1>
      <section>
        <h2>Agents</h2>
        <input placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <input placeholder="provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} />
        <input placeholder="model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <button onClick={addAgent}>Add agent</button>
        <select value={sel} onChange={(e) => setSel(e.target.value)}>
          <option value="">select agent…</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>{a.name} ({a.provider}/{a.model})</option>
          ))}
        </select>
      </section>
      <section>
        <h2>Run</h2>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} />
        <button disabled={!sel || !input} onClick={run}>Run</button>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", padding: 12 }}>{out}</pre>
      </section>
    </main>
  );
}
```

Add beside the agents POST (same `route.ts`):
```ts
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return NextResponse.json(await db.select().from(agents).where(eq(agents.projectId, id)));
}
```
(with `eq` imported from `drizzle-orm`).

- [ ] **Step 7: Manual verify end-to-end (needs worker + any provider)**

Run in three shells (or with Ollama running locally):
`docker compose up -d db` · `DATABASE_URL=... pnpm --filter @pactlane/worker start` · `DATABASE_URL=... BETTER_AUTH_SECRET=... pnpm --filter @pactlane/web dev`
Expected: create project → agent (`openai-compatible` / a model pulled in Ollama) → run "say hi" → text streams into the page; `runs.status='done'` in db.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(web): projects/agents/runs API, SSE run stream, minimal UI" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Full docker compose + quickstart docs

**Files:**
- Modify: `docker-compose.yml` (add `web`, `worker`, optional `ollama` profile)
- Create: `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `scripts/smoke.sh`
- Modify: `README.md` (Quickstart section replacing "early development" caveat)

**Interfaces:**
- Consumes: everything above.
- Produces: `docker compose up` runs the whole stack; `scripts/smoke.sh` exercises signup→project→agent→run via curl and exits 0.

- [ ] **Step 1: Dockerfiles**

`apps/worker/Dockerfile`:
```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/worker ./apps/worker
RUN pnpm install --frozen-lockfile --filter @pactlane/worker...
CMD ["pnpm", "--filter", "@pactlane/worker", "start"]
```

`apps/web/Dockerfile`:
```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages ./packages
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --filter @pactlane/web... && pnpm --filter @pactlane/web build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY --from=build /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@pactlane/web", "start"]
```

- [ ] **Step 2: Compose services**

Append to `docker-compose.yml` `services:`:
```yaml
  worker:
    build: { context: ., dockerfile: apps/worker/Dockerfile }
    environment:
      DATABASE_URL: postgres://pactlane:pactlane@db:5432/pactlane
      OPENAI_COMPATIBLE_BASE_URL: ${OPENAI_COMPATIBLE_BASE_URL:-http://ollama:11434/v1}
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY:-}
      OPENAI_API_KEY: ${OPENAI_API_KEY:-}
    depends_on:
      db: { condition: service_healthy }
  web:
    build: { context: ., dockerfile: apps/web/Dockerfile }
    environment:
      DATABASE_URL: postgres://pactlane:pactlane@db:5432/pactlane
      BETTER_AUTH_SECRET: ${BETTER_AUTH_SECRET:?set in .env}
      BETTER_AUTH_URL: http://localhost:3000
    ports: ["3000:3000"]
    depends_on:
      db: { condition: service_healthy }
  ollama:
    image: ollama/ollama:latest
    profiles: ["local-llm"]
    ports: ["11434:11434"]
    volumes: [ollama:/root/.ollama]
```
and add `ollama:` under `volumes:`.

- [ ] **Step 3: Smoke script**

`scripts/smoke.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
BASE=${BASE:-http://localhost:3000}
JAR=$(mktemp)
curl -sf -c "$JAR" -X POST "$BASE/api/auth/sign-up/email" -H 'content-type: application/json' \
  -d '{"email":"smoke@local.test","password":"smoke-pass-123","name":"smoke"}' >/dev/null || true
curl -sf -b "$JAR" -c "$JAR" -X POST "$BASE/api/auth/sign-in/email" -H 'content-type: application/json' \
  -d '{"email":"smoke@local.test","password":"smoke-pass-123"}' >/dev/null
P=$(curl -sf -b "$JAR" -X POST "$BASE/api/projects" -d '{"name":"smoke"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
A=$(curl -sf -b "$JAR" -X POST "$BASE/api/projects/$P/agents" -d '{"name":"a","provider":"openai-compatible","model":"llama3.1"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
R=$(curl -sf -b "$JAR" -X POST "$BASE/api/agents/$A/runs" -d '{"input":"say hi"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
echo "run: $R — streaming:"
curl -sN -b "$JAR" "$BASE/api/runs/$R/stream" | head -20
echo "SMOKE OK"
```

Run: `chmod +x scripts/smoke.sh`

- [ ] **Step 4: Verify full stack**

Run: `cp .env.example .env` (set `BETTER_AUTH_SECRET`) then `docker compose --profile local-llm up -d --build && docker compose exec ollama ollama pull llama3.1 && ./scripts/smoke.sh`
Expected: streamed events end with `{"type":"status","payload":{"status":"done"}}`, `SMOKE OK`.

- [ ] **Step 5: Update README Quickstart + commit**

Add to `README.md` after the intro:
````markdown
## Quickstart (self-host)

```bash
git clone https://github.com/MelMayssonOwen/pactlane && cd pactlane
cp .env.example .env   # set BETTER_AUTH_SECRET (any 32+ char string)
docker compose --profile local-llm up -d --build
docker compose exec ollama ollama pull llama3.1
open http://localhost:3000
```
Works fully offline with local models; add `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` to `.env` for cloud providers.
````

```bash
git add -A
git commit -m "feat: full docker compose self-host with optional local-llm profile + smoke script" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
git push
```

---

## Self-review notes

- Spec coverage: M1 scope (compose-up, auth, project/agent CRUD, streamed run, durable events, local LLM) is covered by Tasks 1–8. Policies/approvals/swarm messaging/Slack are M2+ by design — see `ARCHITECTURE.md` milestones.
- Type consistency: `RUN_EXECUTE = "run.execute"` appears in Task 5 (`apps/worker/src/queue.ts`) and Task 7 (`apps/web/src/lib/boss.ts`) — keep both literals identical. `StreamFn` shape `{system, prompt, provider, model}` is identical in Tasks 3–5. `appendEvent` returns `Promise<number>` everywhere.
- Version drift risk: AI SDK v5 / Better Auth / pg-boss v10 APIs move fast — if an import or option named here doesn't exist in the installed version, check the package's docs (context7) before improvising, and keep the interfaces in this plan's "Produces" blocks stable.
