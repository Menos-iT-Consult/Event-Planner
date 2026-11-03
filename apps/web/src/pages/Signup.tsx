import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "../App";
import { api } from "../api";

export function Signup({ onSignup }: { onSignup: (user: User) => void }) {
  const [form, setForm] = useState({ name: "", email: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (form.password !== form.confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ user: User }>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify(form),
      });
      onSignup(result.user);
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create your account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-layout">
      <aside className="login-art">
        <Link className="brand brand-light" to="/"><span className="brand-mark">e</span> eventflow</Link>
        <div className="login-art-copy">
          <span className="eyebrow eyebrow-light">CREATE YOUR WORKSPACE</span>
          <h2>Plan clearly.<br /><em>Gather thoughtfully.</em></h2>
        </div>
        <div className="login-art-foot">Event planning, with less busywork.</div>
      </aside>
      <section className="login-content">
        <div className="login-form-wrap">
          <div className="eyebrow">NEW TO EVENTFLOW</div>
          <h1>Create your account</h1>
          <p className="muted">Start with a personal event workspace.</p>
          <form onSubmit={submit} className="stack-form">
            <label>Your name<input required minLength={2} maxLength={120} autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Email address<input required type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
            <label>Password<input required minLength={12} maxLength={200} type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
            <label>Confirm password<input required minLength={12} maxLength={200} type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} /></label>
            <small className="muted">Use at least 12 characters.</small>
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <button className="button button-dark button-wide" disabled={busy}>{busy ? "Creating account..." : "Create account"}</button>
          </form>
          <p className="login-note">Already have an account? <Link to="/login">Sign in</Link></p>
        </div>
      </section>
    </main>
  );
}
