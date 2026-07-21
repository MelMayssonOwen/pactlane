# Architecture (v0)

Decision record, 2026-07-19. Method: two independent clean-room architecture proposals (GPT-5.6-Sol, Grok 4.5), two independent deep web-research reports (GPT-5.6-Sol with search, Grok 4.5), and a 109-agent adversarially-verified research pass (Claude) over the July-2026 OSS landscape, arbitrated into one design.

## Product definition

Per-**project** swarms of AI **agents and services** that:
- message each other (agent ↔ agent, agent ↔ service),
- ping humans (approvals, questions) over a web inbox and Slack,
- are governed by **policies** evaluated on every tool call (allow / deny / require-approval),
- attach tools via **MCP**,
- treat **local LLMs as first-class providers** (OpenAI-compatible endpoints: Ollama, vLLM, llama-server),
- self-host with `docker compose up`, zero proprietary cloud dependencies.

## Layer decisions

| Layer | Decision | Why (and what lost) |
|---|---|---|
| Language | TypeScript everywhere, pnpm monorepo | Founder strength; every research input rejected Python-core frameworks (CrewAI, AG2, CAMEL, AgentScope) for a TS-first product |
| Web | Next.js App Router | Consensus across all inputs |
| Agent runtime | Our own run loop on **AI SDK** providers now; **Mastra** (Apache-2.0 core only, never `ee/`) adopted via a spike when suspend/resume + workflows land (M2) | 3/5 inputs say build-on-Mastra (TS-native, HITL suspend/resume, MCP authoring, new Slack channels + A2A + tool hooks). Mastra wraps AI SDK, so starting on AI SDK is not throwaway. LangGraph.js = MIT patterns reference only (its prod server is license-gated); VoltAgent = MIT plan-B |
| Policy choke point | **One `ToolExecutor` gateway** — the model never sees raw MCP clients or credentials; every tool call (native + MCP) passes a deterministic evaluator: deny > require-approval > allow, default deny. Frozen-args hash on approval + idempotency ledger so an approved call executes exactly once | Both clean-room proposals independently designed this exact shape. OPA-Wasm considered (Codex research) — deferred; v0 policies are JSON rules |
| DB | PostgreSQL + Drizzle. One store for state, events (append-only `run_events`), policies, approvals, jobs | Unanimous |
| Messaging (swarm bus) | **Postgres-first**: transactional outbox + **pg-boss** jobs, `LISTEN/NOTIFY` as wake-up signal only. Bus behind our own interface so **NATS JetStream** can replace it when fan-out/multi-node justifies it | Arbitrated middle of NATS-now (Claude fleet), Redis Streams (Grok), Postgres-only (both arch proposals + Codex research). Keeps compose = web + worker + postgres |
| Agent↔agent / agent↔human pings | Project-scoped `messages` envelope in Postgres, delivered via the bus; humans see a room/inbox view | Real OSS systems use in-process or DB/bus messaging, not a wire protocol (AgentScope MsgHub, Paperclip DB queue, OpenSail Redis) |
| Protocols | **MCP for tools/services**. **A2A** only as a future edge/federation adapter (spec v1, LF-governed, but JS SDK stable line still v0.3) | Unanimous: adopt both standards, build neither, core on neither |
| HITL / approvals | Build ourselves: approval row in Postgres mutated by web inbox **and** Slack Block Kit buttons via compare-and-swap; ack Slack <3s, resume idempotently. Patterns mined from LangGraph interrupt middleware (MIT) + HumanLayer SDK (Apache-2.0, deprecated) | Canonical OSS approval SDK (HumanLayer) is dead — verified; every input said build this layer |
| Auth | **Better Auth**, email/password, first-user-is-owner | Both proposals; also the existing portfolio standard. No Auth0/Supabase Auth |
| Local LLMs | Everything speaks OpenAI-compatible `baseURL`. Dev: Ollama. Prod concurrency: **vLLM** (~22–34× Ollama throughput at 100 concurrent users, peer-reviewed May-2026 benchmark). Optional **LiteLLM** proxy compose profile for routing/budgets. Per-model **capability probes** (tool-calling on small models is unreliable), strict server-side schema validation, parallel tool calls off by default | Unanimous |
| Deploy | Docker Compose: `web`, `worker`, `postgres` (+ optional `ollama`, `litellm` profiles) | Unanimous |

## Components

```
Browser / Slack
  └─ Next.js (UI + API routes, Better Auth)
       ├─ project & swarm builder, run view, approvals inbox
       └─ enqueue runs / decisions → Postgres (outbox + pg-boss)
            ▼
       Worker (Node)
         └─ Run loop (AI SDK providers: anthropic | openai | openai-compatible)
              ├─ swarm messages (project-scoped envelope, bus-delivered)
              └─ ★ ToolExecutor ── sole tool path
                    └─ ★ PolicyEngine (deny > approve > allow, default deny)
                          ├─ deny → audited tool error, run continues
                          ├─ require-approval → freeze args hash, suspend run,
                          │     notify web inbox + Slack → resume on decision
                          └─ allow / approved-hash → idempotency ledger → MCP / builtin
```

## Hardest risk (both clean-room proposals agreed)

Crash-safe suspend/resume around approvals with no bypass path and no duplicate side effects. De-risk first: build the state machine against a fake model + a destructive-counter MCP tool, kill the process at every transition, prove deny never executes, approvals execute the frozen hash exactly once, and resume continues the same run.

## Milestones

1. **M1 Foundation** — compose up → login → create project + agent → streamed single-agent run, events durable in Postgres, local LLM works via OpenAI-compatible baseURL. *(plan: `docs/plans/2026-07-19-m1-foundation.md`)*
2. **M2 Policy kernel** — SHIPPED 2026-07-21: ToolExecutor + PolicyEngine + approvals inbox + crash-safe pause/resume, verified E2E. Mastra spike verdict: stay-custom (hooks can't hard-enforce the choke point); revisit only @mastra/mcp as an adapter behind invokeTool at M3.
3. **M3 Swarm** — multi-agent-and-service projects, shared context, agent↔agent messages, room view.
4. **M4 Builder** — no-code swarm builder, MCP attach, templates, capability probes.
5. **M5 Slack** — interactive approvals + notifications; self-host docs pass.

## Explicit v0 cuts

Visual DAG canvas, iMessage, marketplace/OAuth brokerage, SSO/RBAC beyond admin-member, billing, vector memory/RAG, Kubernetes/HA, policy DSL (JSON rules only), autonomous swarm planning, cron triggers.

## Prior art studied (not forked)

desplega-ai/agent-swarm (MIT, TS — closest living OSS analog), OpenSail (Apache-2.0, Python core), Paperclip (MIT TS, governance focus), SwarmClaw (MIT TS, early), Hivemind (AGPL/Rails), AgentTeams (Apache-2.0, Matrix-centric), HumanLayer (Apache-2.0, deprecated — approval patterns), OpenClaw (MIT, personal single-user agent — channel patterns).
