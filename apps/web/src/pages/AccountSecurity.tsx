import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import type { User } from "../App";
import { api } from "../api";
import { CubeLoader } from "../components/CubeLoader";
import { PasswordInput } from "../components/PasswordInput";
import "./AccountSecurity.css";

function AccountLayout({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <main className="account-security-layout">
      <aside className="login-art">
        <Link className="brand brand-light" to="/"><span className="brand-mark">e</span> eventflow</Link>
        <div className="login-art-copy"><span className="eyebrow eyebrow-light">ACCOUNT SECURITY</span><h2>A safe place<br /><em>for your plans.</em></h2></div>
      </aside>
      <section className="login-content"><div className="login-form-wrap"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{children}</div></section>
    </main>
  );
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ message: string }>("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMessage(result.message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not request password recovery");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountLayout eyebrow="PASSWORD RECOVERY" title="Forgot your password?">
      <p className="muted account-intro">Enter the email address for your EventFlow account. If it exists, password recovery details will be sent.</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Email address<input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {message && <div className="alert alert-success" role="status">{message}</div>}
        <button className="button button-dark" disabled={busy}>{busy ? <CubeLoader label="Sending" compact /> : "Send recovery details"}</button>
      </form>
      <p className="login-note"><Link to="/login">Return to sign in</Link></p>
    </AccountLayout>
  );
}

export function ResetPassword() {
  const [params] = useSearchParams();
  const isInvitation = params.get("invite") === "1";
  const [token, setToken] = useState(params.get("token") ?? "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setBusy(true);
    try {
      await api(isInvitation ? "/api/auth/accept-admin-invite" : "/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password, confirmPassword }),
      });
      setMessage(isInvitation ? "Your invitation is accepted. You can now sign in." : "Your password has been reset.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not reset password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountLayout eyebrow={isInvitation ? "EVENTFLOW INVITATION" : "RESET PASSWORD"} title={isInvitation ? "Set your account password" : "Create a new password"}>
      <p className="muted account-intro">{isInvitation ? "Choose a password to accept your EventFlow invitation." : "Use the recovery token from your email, or open this page with a valid recovery link."}</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Recovery token<input required minLength={32} value={token} onChange={(event) => setToken(event.target.value)} /></label>
        <label>New password<PasswordInput minLength={8} required autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <label>Confirm password<PasswordInput minLength={8} required autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {message && <div className="alert alert-success" role="status">{message}</div>}
        <button className="button button-dark" disabled={busy}>{busy ? <CubeLoader label="Reset" compact /> : "Reset password"}</button>
      </form>
      <p className="login-note"><Link to="/login">Return to sign in</Link></p>
    </AccountLayout>
  );
}

export function TwoFactorChallenge({ onLogin }: { onLogin: (user: User) => void }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as { email?: string; password?: string; returnTo?: string } | null;
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!state?.email || !state.password) {
      navigate("/login", { replace: true });
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { user } = await api<{ user: User }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: state.email, password: state.password, code: code.trim().toUpperCase() }),
      });
      onLogin(user);
      navigate(state.returnTo ?? "/dashboard", { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify the authentication code");
    } finally {
      setBusy(false);
    }
  }

  if (!state?.email || !state.password) {
    return <AccountLayout eyebrow="TWO-FACTOR AUTHENTICATION" title="Verification required"><p className="muted account-intro">Sign in again to begin two-factor verification.</p><Link className="button button-dark" to="/login">Return to sign in</Link></AccountLayout>;
  }

  return (
    <AccountLayout eyebrow="TWO-FACTOR AUTHENTICATION" title="Enter your verification code">
      <p className="muted account-intro">Enter the 6-digit code from your authenticator app or one unused backup code.</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Authentication code<input required minLength={6} maxLength={10} autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 10).toUpperCase())} placeholder="000000 or backup code" /></label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="button button-dark" disabled={busy}>{busy ? <CubeLoader label="Verify" compact /> : "Verify and sign in"}</button>
      </form>
      <p className="login-note"><Link to="/login">Start sign in again</Link></p>
    </AccountLayout>
  );
}

interface SessionItem {
  id: string;
  device: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string;
  current: boolean;
}

export function SessionManagement() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function loadSessions() {
    try {
      const result = await api<{ sessions: SessionItem[] }>("/api/auth/sessions");
      setSessions(result.sessions);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load active sessions");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSessions(); }, []);

  async function revokeOthers() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ revoked: number }>("/api/auth/sessions/revoke-others", { method: "POST" });
      setMessage(`${result.revoked} other session${result.revoked === 1 ? "" : "s"} signed out.`);
      await loadSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign out other sessions");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(session: SessionItem) {
    setBusy(true);
    setError("");
    try {
      await api(`/api/auth/sessions/${session.id}`, { method: "DELETE" });
      if (session.current) {
        navigate("/login", { replace: true });
        return;
      }
      setMessage("Session signed out.");
      await loadSessions();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign out this session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AccountLayout eyebrow="ACCOUNT SECURITY" title="Active sessions">
      <p className="muted account-intro">Review signed-in devices and revoke sessions you no longer recognize.</p>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {loading ? <p className="muted">Loading sessions…</p> : sessions.length ? (
        <div className="session-list">
          {sessions.map((session) => <article className="session-item" key={session.id}>
            <div><strong>{session.current ? "This device" : "Signed-in device"}</strong><small>{session.device ?? "Device details unavailable"}</small><small>Last active {session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString() : "not recorded"} · Expires {new Date(session.expiresAt).toLocaleString()}</small></div>
            <button className="text-button" disabled={busy} onClick={() => void revoke(session)}>Sign out</button>
          </article>)}
          <button className="button button-outline" disabled={busy || sessions.length < 2} onClick={() => void revokeOthers()}>Sign out other sessions</button>
        </div>
      ) : <div className="empty-note">No active sessions are available.</div>}
      <p className="login-note"><Link to="/dashboard">Back to workspace</Link></p>
    </AccountLayout>
  );
}
