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
    const res = mode === "in"
      ? await authClient.signIn.email({ email, password })
      : await authClient.signUp.email({ email, password, name: email.split("@")[0] });
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
