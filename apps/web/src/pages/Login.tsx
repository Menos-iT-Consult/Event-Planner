import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "../App";
import { api } from "../api";

export function Login({ onLogin }: { onLogin: (user: User) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      onLogin(user);
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <aside className="login-art">
        <Link className="brand brand-light" to="/"><span className="brand-mark">e</span> eventflow</Link>
        <div className="login-art-copy"><span className="eyebrow eyebrow-light">A home for your next big thing</span><h2>All the little details.<br /><em>One lovely place.</em></h2></div>
        <div className="login-art-shapes"><span>✿</span><span>✳</span><span>♡</span></div>
        <div className="login-art-foot">Thoughtful planning, right on time.</div>
      </aside>
      <section className="login-content">
        <div className="login-form-wrap">
          <div className="eyebrow">WELCOME BACK</div>
          <h1>Sign in to EventFlow</h1>
          <p className="muted">Pick up where your good plans left off.</p>
          <form onSubmit={submit} className="stack-form">
            <label>Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" /></label>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <button className="button button-dark button-wide" disabled={busy}>{busy ? "Signing in..." : "Sign in"} <span aria-hidden="true">↗</span></button>
          </form>
          <p className="login-note">Your administrator can create your EventFlow account.</p>
        </div>
      </section>
    </main>
  );
}
