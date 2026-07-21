"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Approval = {
  id: string;
  toolName: string;
  args: unknown;
  createdAt: string;
  run: { id: string; input: string };
  project: { id: string; name: string };
};

type Decision = "approved" | "denied";

export default function Approvals() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/approvals")
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load approvals");
        return (await response.json()) as Approval[];
      })
      .then((pending) => {
        if (active) setApprovals(pending);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(reason instanceof Error ? reason.message : "Failed to load approvals");
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  async function decide(approval: Approval, decision: Decision) {
    setError("");
    setApprovals((current) => current.filter((item) => item.id !== approval.id));

    try {
      const response = await fetch(`/api/approvals/${approval.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error ?? "Failed to decide approval");
      }
    } catch (reason) {
      setApprovals((current) =>
        current.some((item) => item.id === approval.id)
          ? current
          : [...current, approval].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
      );
      setError(reason instanceof Error ? reason.message : "Failed to decide approval");
    }
  }

  return (
    <main style={{ maxWidth: 760, margin: "5vh auto", display: "grid", gap: 16 }}>
      <nav>
        <Link href="/">← Projects</Link>
      </nav>
      <h1>Approvals</h1>
      {error && <p style={{ color: "red" }}>{error}</p>}
      {loading ? (
        <p>Loading…</p>
      ) : approvals.length === 0 ? (
        <p>No pending approvals.</p>
      ) : (
        approvals.map((approval) => (
          <article
            key={approval.id}
            style={{ border: "1px solid #bbb", borderRadius: 6, padding: 16, display: "grid", gap: 10 }}
          >
            <p>
              <strong>{approval.project.name}</strong>
            </p>
            <p>{approval.run.input}</p>
            <p>
              Tool: <code>{approval.toolName}</code>
            </p>
            <pre style={{ whiteSpace: "pre-wrap", background: "#f4f4f4", color: "#171717", padding: 12 }}>
              {JSON.stringify(approval.args, null, 2)}
            </pre>
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => void decide(approval, "approved")}>Approve</button>
              <button onClick={() => void decide(approval, "denied")}>Deny</button>
            </div>
          </article>
        ))
      )}
    </main>
  );
}
