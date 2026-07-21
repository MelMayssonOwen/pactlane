"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

type Agent = { id: string; name: string; provider: string; model: string };
type PolicyEffect = "allow" | "deny" | "require_approval";
type Policy = {
  id: string;
  toolMatch: string;
  effect: PolicyEffect;
  priority: number;
  enabled: boolean;
};

export default function Project() {
  const { id } = useParams<{ id: string }>();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [sel, setSel] = useState("");
  const [input, setInput] = useState("");
  const [out, setOut] = useState("");
  const [form, setForm] = useState({ name: "", provider: "openai-compatible", model: "llama3.1" });
  const [policyForm, setPolicyForm] = useState<{
    toolMatch: string;
    effect: PolicyEffect;
    priority: number;
  }>({ toolMatch: "", effect: "require_approval", priority: 0 });

  const refreshAgents = () =>
    fetch(`/api/projects/${id}/agents`).then((r) => r.json()).then(setAgents);
  const refreshPolicies = () =>
    fetch(`/api/projects/${id}/policies`).then((r) => r.json()).then(setPolicies);
  useEffect(() => {
    void Promise.all([refreshAgents(), refreshPolicies()]);
  }, [id]);

  async function addAgent() {
    await fetch(`/api/projects/${id}/agents`, { method: "POST", body: JSON.stringify(form) });
    await refreshAgents();
  }
  async function addPolicy() {
    await fetch(`/api/projects/${id}/policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policyForm),
    });
    setPolicyForm({ ...policyForm, toolMatch: "" });
    await refreshPolicies();
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
      <section style={{ display: "grid", gap: 8 }}>
        <h2>Policies</h2>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input
            placeholder="tool match, e.g. http.*"
            value={policyForm.toolMatch}
            onChange={(e) => setPolicyForm({ ...policyForm, toolMatch: e.target.value })}
          />
          <select
            value={policyForm.effect}
            onChange={(e) => setPolicyForm({ ...policyForm, effect: e.target.value as PolicyEffect })}
          >
            <option value="allow">allow</option>
            <option value="deny">deny</option>
            <option value="require_approval">require approval</option>
          </select>
          <input
            aria-label="policy priority"
            type="number"
            value={policyForm.priority}
            onChange={(e) => setPolicyForm({ ...policyForm, priority: Number(e.target.value) })}
            style={{ width: 80 }}
          />
          <button disabled={!policyForm.toolMatch.trim()} onClick={addPolicy}>Add policy</button>
        </div>
        {policies.length === 0 ? (
          <p>No policies. Unmatched tools are denied.</p>
        ) : (
          <ul>
            {policies.map((policy) => (
              <li key={policy.id}>
                <code>{policy.toolMatch}</code> → {policy.effect.replace("_", " ")} (priority {policy.priority})
                {!policy.enabled && " — disabled"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
