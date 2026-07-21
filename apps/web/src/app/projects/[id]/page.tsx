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
