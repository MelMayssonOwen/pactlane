# pactlane

**Open-source, self-hosted workspace for AI agent packs — per-project swarms of agents and services that work together under a pact: your policies, your approvals, your infrastructure.**

## Quickstart (self-host)

```bash
git clone https://github.com/MelMayssonOwen/pactlane && cd pactlane
cp .env.example .env   # set BETTER_AUTH_SECRET (any 32+ char string)
docker compose --profile local-llm up -d --build
docker compose exec ollama ollama pull llama3.1
open http://localhost:3000
```
Works fully offline with local models; add `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` to `.env` for cloud providers.

## What this is

- **Agent packs, not single agents** — compose multiple agents (Claude, OpenAI, open-weight models) and services into per-project teams with shared context, messaging each other and pinging humans.
- **The pact: policies & approvals** — every tool call passes one policy choke point: allow, deny, or require human sign-off before it executes. Human-in-the-loop by design, in a web inbox and Slack.
- **No-code workspace** — spin up, configure, and watch agent packs from a web UI.
- **MCP-native** — tools and integrations attach via the Model Context Protocol.
- **Local LLMs first-class** — any OpenAI-compatible endpoint (Ollama, vLLM, llama-server) is a provider like any other.
- **Self-hosted, fully open** — MIT, one `docker compose up`, zero proprietary cloud dependencies. Your prompts, keys, and approval decisions never leave your infrastructure.

## Why

An orchestration layer sees every prompt, tool call, credential, and approval decision your agents make. That layer should be inspectable, self-hostable, and owned by its users.

## Status

M1 (foundation) and M2 (policy kernel) are shipped and verified end-to-end: auth → projects → agents → policy-gated tool runs. Every tool call passes one choke point (allow / deny / require-approval, default deny); approval-gated runs suspend crash-safely, resume on human decision, and execute the approved call exactly once — verified live with a local model. Next: agent packs (multi-agent + services per project), the no-code builder, and Slack. See `ARCHITECTURE.md`.

## Contributing

Early enough that everything is up for discussion — open an issue with what you'd want from an open agent-pack workspace. License: MIT.
