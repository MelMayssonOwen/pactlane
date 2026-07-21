# M2 Policy Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every tool call an agent makes passes exactly one choke point that evaluates policies (allow / deny / require-approval, default deny); require-approval suspends the run crash-safely, a human decides in the web inbox, and the approved call executes **exactly once** with the frozen arguments.

**Architecture:** `packages/runtime` grows a tool loop: the model requests tool calls (tools carry no `execute` — the model can never run one directly); `ToolExecutor.invoke()` is the only execution path and consults `PolicyEngine` first. `require_approval` persists a checkpoint (messages + pending call + args hash) on the run, writes an `approvals` row, and suspends. A decision re-enqueues the run; resume replays from the checkpoint and the idempotency ledger (`tool_invocations`, unique per `tool_call_id`) guarantees exactly-once side effects even across crashes. See `ARCHITECTURE.md`.

**Tech Stack:** unchanged from M1 (AI SDK v5, Drizzle, pg-boss, Next.js, Vitest). New: `zod` for builtin tool schemas (already a transitive dep of `ai`; add explicitly).

## Global Constraints

- Repo is PUBLIC. Never commit credentials or `.env`; never commit AI working notes. No competitor names anywhere.
- `"strict": true`; no `any` in exported signatures. pnpm only. Every commit ends with trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- DB tests skip-with-message when `DATABASE_URL` unset. Use `postgres://pactlane:pactlane@localhost:5432/pactlane`.
- THE invariant (test-enforced, never weakened): no code path executes a tool except `ToolExecutor.invoke`, and `invoke` evaluates policy before anything else. Default effect when no policy matches is **deny**.
- Suspend/resume must tolerate a process kill at ANY point; duplicate job delivery must never re-execute an executed tool call.

---

### Task 1: Schema — policies, approvals, tool_invocations, checkpoint

**Files:**
- Modify: `packages/db/src/schema.ts`
- Test: `packages/db/src/schema-m2.test.ts`

**Interfaces (Produces):**
- `RunStatus` union gains `"awaiting_approval"`.
- `runs` gains `checkpoint: jsonb` (nullable).
- New tables exported from `@pactlane/db`:

```ts
export type PolicyEffect = "allow" | "deny" | "require_approval";

export const policies = pgTable("policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  toolMatch: text("tool_match").notNull(), // glob: "*", "counter.*", "http.fetch"
  effect: text("effect").$type<PolicyEffect>().notNull(),
  priority: integer("priority").notNull().default(0), // higher wins within same effect class
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ApprovalStatus = "pending" | "approved" | "denied";

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
  toolCallId: text("tool_call_id").notNull(),
  toolName: text("tool_name").notNull(),
  args: jsonb("args").notNull(),
  argsHash: text("args_hash").notNull(),
  status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type InvocationStatus = "executed" | "denied" | "failed";

export const toolInvocations = pgTable(
  "tool_invocations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id").notNull().references(() => runs.id, { onDelete: "cascade" }),
    toolCallId: text("tool_call_id").notNull(),
    toolName: text("tool_name").notNull(),
    argsHash: text("args_hash").notNull(),
    status: text("status").$type<InvocationStatus>().notNull(),
    result: jsonb("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("tool_invocations_call").on(t.runId, t.toolCallId)],
);
```

**Steps:**
- [ ] Write failing test `schema-m2.test.ts`: insert a policy, an approval, a tool_invocation for a seeded run; assert unique `(run_id, tool_call_id)` on toolInvocations rejects a duplicate insert (expect the second insert to throw). Assert `runs.checkpoint` roundtrips a JSON object.
- [ ] Run: `DATABASE_URL=... pnpm --filter @pactlane/db test` → FAIL (tables missing).
- [ ] Add the schema above + `checkpoint: jsonb("checkpoint")` on `runs` + `"awaiting_approval"` in `RunStatus`. Run `pnpm --filter @pactlane/db generate && DATABASE_URL=... pnpm --filter @pactlane/db migrate`.
- [ ] Test passes. Commit `feat(db): M2 schema — policies, approvals, tool_invocations, run checkpoint`.

---

### Task 2: PolicyEngine (pure) + args hashing

**Files:**
- Create: `packages/runtime/src/policy.ts`, `packages/runtime/src/hash.ts`
- Test: `packages/runtime/src/policy.test.ts`, `packages/runtime/src/hash.test.ts`

**Interfaces (Produces):**

```ts
// policy.ts — pure, no db
export type PolicyRule = { toolMatch: string; effect: "allow" | "deny" | "require_approval"; priority: number; enabled: boolean };
export function evaluatePolicy(rules: PolicyRule[], toolName: string): "allow" | "deny" | "require_approval";
// Semantics: consider enabled rules whose glob matches toolName ("*" matches any chars, no other metachars).
// Among matches, highest priority wins; on priority tie, deny > require_approval > allow. NO match → "deny".

// hash.ts
export function canonicalJson(value: unknown): string; // recursively sort object keys, stable output
export function hashArgs(value: unknown): string;      // sha256 hex of canonicalJson (node:crypto)
```

**Steps:**
- [ ] Failing tests: glob matching (`*`, `counter.*`, exact), priority override (allow p10 beats deny p0), tie → deny wins, no-match → deny, disabled rules ignored; hash: key order irrelevant (`{a:1,b:2}` ≡ `{b:2,a:1}`), nested objects, arrays order-sensitive, different values → different hash.
- [ ] Implement:

```ts
// policy.ts
export function evaluatePolicy(rules: PolicyRule[], toolName: string): "allow" | "deny" | "require_approval" {
  const rank = { deny: 2, require_approval: 1, allow: 0 } as const;
  const matches = rules.filter(
    (r) => r.enabled && new RegExp(`^${r.toolMatch.split("*").map(escapeRe).join(".*")}$`).test(toolName),
  );
  if (matches.length === 0) return "deny";
  matches.sort((a, b) => b.priority - a.priority || rank[b.effect] - rank[a.effect]);
  return matches[0]!.effect;
}
function escapeRe(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}
```

```ts
// hash.ts
import { createHash } from "node:crypto";
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}
function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object")
    return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sortValue(x)]));
  return v;
}
export function hashArgs(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
```

- [ ] Tests pass. Commit `feat(runtime): pure policy engine + canonical args hashing`.

---

### Task 3: ToolExecutor + registry + suspend signal

**Files:**
- Create: `packages/runtime/src/tools.ts`, `packages/runtime/src/executor.ts`
- Test: `packages/runtime/src/executor.test.ts`

**Interfaces (Produces):**

```ts
// tools.ts
import { z } from "zod";
export type ToolDef = {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  execute: (args: unknown) => Promise<unknown>;
};
export class RunSuspended extends Error {
  constructor(public readonly approvalId: string) { super("run suspended for approval"); }
}

// executor.ts
export type ExecutorCtx = { db: Db; runId: string; projectId: string };
export type InvokeResult = { ok: true; result: unknown } | { ok: false; error: string };
// The ONLY tool execution path in the codebase:
export async function invokeTool(ctx: ExecutorCtx, tools: ToolDef[], call: { toolCallId: string; toolName: string; args: unknown }): Promise<InvokeResult>;
```

`invokeTool` algorithm (implement exactly):
1. Ledger check: existing `tool_invocations` row for `(runId, toolCallId)` → return its stored outcome (`executed` → `{ok:true,result}`, `denied`/`failed` → `{ok:false,error}`). Never re-execute.
2. `argsHash = hashArgs(call.args)`. Load enabled policies for `ctx.projectId`; `effect = evaluatePolicy(...)`.
3. Append `run_events` row `{type:"policy", payload:{toolName, toolCallId, effect}}`.
4. `deny` → insert invocation `{status:"denied"}`, return `{ok:false, error:"denied by policy"}`.
5. `require_approval` → check for an existing approval for `(runId, toolCallId)`:
   - none → insert approval (pending, with args + argsHash), append event `{type:"approval_requested"}`, throw `new RunSuspended(approvalId)`.
   - `pending` → throw `RunSuspended(approvalId)` (still waiting; re-delivery case).
   - `denied` → insert invocation `denied`, return `{ok:false, error:"denied by user"}`.
   - `approved` → verify `approval.argsHash === argsHash`; mismatch → invocation `failed`, return `{ok:false, error:"frozen args mismatch"}`. Match → fall through to execute (frozen-args guarantee).
6. Execute: find tool by name (missing → `{ok:false,error:"unknown tool"}` + invocation `failed`); validate args with `inputSchema.safeParse` (fail → invocation `failed`); run `execute`; insert invocation `{status:"executed", result}`; append event `{type:"tool_result"}`; return `{ok:true, result}`.
7. Any thrown tool error → invocation `failed` with the message, return `{ok:false, error}`.

**Steps:**
- [ ] Failing tests using a **destructive counter tool** (`counter.increment`, increments a module-level number) against the real db: (a) allow policy → executes once, ledger row `executed`; (b) same toolCallId invoked again → counter unchanged, stored result returned; (c) deny policy → counter unchanged, `denied by policy`; (d) no policies → default deny; (e) require_approval → throws `RunSuspended`, approval row pending, counter unchanged; invoked again while pending → throws again, still one approval row; (f) after `approvals.status='approved'` set manually → executes exactly once; (g) approved but args tampered (different args, same toolCallId) → `frozen args mismatch`, counter unchanged.
- [ ] Add `"zod": "^4.0.0"` to `packages/runtime/package.json`. Implement per the algorithm. Tests pass.
- [ ] Commit `feat(runtime): ToolExecutor choke point with policy gate, approval suspend, idempotency ledger`.

---

### Task 4: Runtime tool loop with checkpoint + resume

**Files:**
- Modify: `packages/runtime/src/executeRun.ts` (extend, keep text-only path working), `packages/runtime/src/providers.ts`, `packages/runtime/src/index.ts`
- Test: `packages/runtime/src/toolLoop.test.ts`

**Interfaces (Produces):**

```ts
// New injectable turn abstraction (replaces raw StreamFn *inside* the loop; StreamFn stays for back-compat in M1 tests):
export type TurnEvent =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown }
  | { type: "finish" };
export type AgentTurnFn = (args: {
  system: string;
  messages: ModelMessage[]; // from "ai"
  provider: string;
  model: string;
  tools: ToolDef[];
}) => AsyncIterable<TurnEvent>;

export type Checkpoint = { messages: ModelMessage[]; pendingCall?: { toolCallId: string; toolName: string; args: unknown; argsHash: string } };

export async function executeRunWithTools(db: Db, runId: string, turn: AgentTurnFn, tools: ToolDef[]): Promise<void>;
export const aiTurn: AgentTurnFn; // real impl: streamText with execute-less tools (see below)
```

`executeRunWithTools` algorithm (implement exactly):
1. Load run. Proceed only if status is `queued` or `awaiting_approval`; else return.
2. `checkpoint` = run.checkpoint ?? `{ messages: [{ role: "user", content: run.input }] }`.
3. If resuming with `checkpoint.pendingCall`: call `invokeTool` for it (the approval decision determines the outcome), append the assistant tool-call + tool-result messages to `checkpoint.messages`, clear `pendingCall`, persist checkpoint. (`RunSuspended` here → still pending → set status `awaiting_approval`, return.)
4. Set status `running`, append status event.
5. Loop (max 8 iterations):
   a. Run `turn(...)`; append `text` events to `run_events` as `{type:"text"}` and accumulate assistant text; collect tool-calls.
   b. No tool-calls → append assistant message, mark `done` (+event, finishedAt), clear checkpoint, return.
   c. For each tool-call: append event `{type:"tool_call"}`; **before invoking**, persist checkpoint with `pendingCall` = this call (crash here must resume into the same call); then `invokeTool`.
      - `RunSuspended` → set status `awaiting_approval` + event; return (checkpoint already has pendingCall).
      - Result → append assistant tool-call message + tool message with the result to `checkpoint.messages`, clear `pendingCall`, persist checkpoint.
   d. Continue loop.
6. Loop exhausted → mark `failed` with error "max tool iterations".
7. Errors behave as in M1 (`failed` + error event). Never throw.

`aiTurn` real impl: `streamText({ model: resolveModel(...), system, messages, tools: toolsToAiTools(tools) })` where `toolsToAiTools` maps each `ToolDef` to `{ description, inputSchema }` — **no `execute` key**, so the SDK surfaces `tool-call` parts instead of running anything. Iterate `fullStream`: `text-delta` → text event; `tool-call` part → tool-call event (`toolCallId`, `toolName`, `input` as args); `error` part → throw (M1 fix preserved); on stream end emit `finish`.

**Steps:**
- [ ] Failing tests with a scripted `AgentTurnFn` (first turn requests `counter.increment`, second turn returns text "done") + destructive counter + real db:
  1. **allow path**: run completes `done`, counter=1, events contain policy/tool_call/tool_result.
  2. **approval crash-kill path**: policy require_approval → after first `executeRunWithTools` run status is `awaiting_approval`, counter=0. Simulate crash+redelivery: call `executeRunWithTools` again → still `awaiting_approval`, ONE approval row, counter=0. Approve via SQL. Call again → resumes, counter=1, status `done`. Call a 4th time → idempotent no-op (status stays `done`, counter=1).
  3. **deny decision**: as (2) but set approval `denied` → run completes `done` (model told the call was denied), counter=0.
  4. **exactly-once under duplicate delivery after approval**: approve, then run `executeRunWithTools` twice concurrently (`Promise.all`) → counter=1 (ledger + advisory-locked events hold).
- [ ] Implement. Update `apps/worker/src/queue.ts` handler to call `executeRunWithTools(db, runId, aiTurn, builtinTools)` (builtinTools from Task 5; for this task export `const builtinTools: ToolDef[] = []` placeholder-free by moving Task 5's `http.fetch` here if simpler — otherwise wire in Task 5 and keep worker on the old path until then).
- [ ] Tests pass; full workspace suite + typecheck green. Commit `feat(runtime): policy-gated tool loop with crash-safe checkpoint suspend/resume`.

---

### Task 5: Builtin tool + worker wiring

**Files:**
- Create: `packages/runtime/src/builtins.ts`
- Modify: `apps/worker/src/queue.ts`
- Test: `packages/runtime/src/builtins.test.ts`, update `apps/worker/src/queue.test.ts`

**Interfaces (Produces):**

```ts
export const httpFetchTool: ToolDef; // name "http.fetch", input { url: string (https only), method?: "GET" }, returns { status, body: first 4000 chars }
export const builtinTools: ToolDef[]; // [httpFetchTool]
```

**Steps:**
- [ ] Failing tests: schema rejects `http://` (https only) and missing url; a real fetch of `https://example.com` returns status 200 and truncated body (skip-with-message if `OFFLINE=1`).
- [ ] Implement with global `fetch`; wire worker: `executeRunWithTools(db, job.data.runId, aiTurn, builtinTools)`; update the worker test to use a scripted turn fn via `startWorker({ turn })` override (add optional `turn?: AgentTurnFn` to `startWorker` opts, defaulting to `aiTurn`; remove the old `stream` option and delete the now-unused text-only path from queue.ts).
- [ ] Tests pass. Commit `feat(runtime,worker): http.fetch builtin behind the policy gate`.

---

### Task 6: Web — approvals inbox + policies API + resume

**Files:**
- Create: `apps/web/src/app/api/approvals/route.ts` (GET pending, joined with run/project), `apps/web/src/app/api/approvals/[id]/route.ts` (POST decide), `apps/web/src/app/api/projects/[id]/policies/route.ts` (GET list / POST create), `apps/web/src/app/approvals/page.tsx`
- Modify: `apps/web/src/app/projects/[id]/page.tsx` (policies section), `apps/web/src/app/page.tsx` (link to /approvals)
- Test: `apps/web/src/app/api/approvals.test.ts`

**Interfaces (Produces):**
- `POST /api/approvals/:id` body `{decision: "approved" | "denied"}` → CAS: `UPDATE approvals SET status=$1, decided_by=$user, decided_at=now() WHERE id=$2 AND status='pending' RETURNING *`; 0 rows → 409. On success → `boss.send("run.execute", {runId})` to resume; respond with the updated row.
- `POST /api/projects/:id/policies` body `{toolMatch, effect, priority?}` → policy row. `GET` lists.
- `/approvals` page: pending approvals with run input, tool name, pretty-printed args, Approve/Deny buttons calling the API, optimistic removal.

**Steps:**
- [ ] Failing test: create project/agent/run + pending approval directly in db → GET returns it; POST decide approves (row updated, status approved); second POST decide → 409.
- [ ] Implement routes + minimal pages (match existing inline-style idiom).
- [ ] Tests pass; typecheck green. Commit `feat(web): approvals inbox with CAS decisions + policies API, resume on decision`.

---

### Task 7: E2E verification + docs

**Files:**
- Modify: `scripts/smoke.sh` (add gated-tool scenario), `README.md` + `ARCHITECTURE.md` (status), `docs/plans/2026-07-21-m2-policy-kernel.md` (check boxes)

**Steps:**
- [ ] Extend smoke: after the plain run, create a `require_approval` policy for `http.fetch` (`POST /api/projects/$P/policies`), create a run whose input instructs fetching `https://example.com`, poll until run status `awaiting_approval` (via a new `GET /api/runs/:id` route — add it, returning the run row), approve via `POST /api/approvals/:id`, then poll the stream/run to `done`. Exit nonzero on any timeout. NOTE: needs a tool-capable model; smoke accepts `SMOKE_MODEL` and this scenario is skipped with a warning unless `SMOKE_TOOLS=1`.
- [ ] Validator runs: full test suite ×2, typecheck, compose build, plain smoke, and the gated scenario with a tool-capable model (cloud key or capable local model).
- [ ] Update README Status + ARCHITECTURE milestones (M2 shipped). Commit `feat: M2 policy kernel — verified end-to-end` and push.

---

## Self-review notes

- The invariant test lives in Task 3(d) (default deny) and Task 4's crash-kill suite; `aiTurn` passing execute-less tools is what makes `invokeTool` the only path — never add `execute` to the AI-SDK tool mapping.
- Type consistency: `ToolDef`, `TurnEvent`, `AgentTurnFn`, `Checkpoint`, `invokeTool`, `executeRunWithTools`, queue name `"run.execute"` — spellings above are canonical across tasks.
- Version drift: verify AI SDK v5 execute-less tool behavior and `tool-call` part property names (`input` vs `args`) against `node_modules/ai/dist/index.d.ts` before implementing `aiTurn` (M1 precedent: fullStream `text-delta` uses `.text`).
