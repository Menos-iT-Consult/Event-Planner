import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { PasswordInput } from "../components/PasswordInput";
import type { User } from "../App";
import "./AccountSecurity.css";

export function TwoFactorSetup({ user, onUserUpdate }: { user: User; onUserUpdate: (user: User) => void }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [secret, setSecret] = useState("");
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function setup() {
    setError("");
    try {
      const result = await api<{ secret: string; backupCodes: string[]; qrCodeDataUrl: string }>("/api/auth/2fa/setup", { method: "POST" });
      setSecret(result.secret);
      setBackupCodes(result.backupCodes);
      setQrCodeDataUrl(result.qrCodeDataUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not set up two-factor authentication");
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/auth/2fa/verify", { method: "POST", body: JSON.stringify({ code }) });
      const { user: updatedUser } = await api<{ user: User }>("/api/auth/me");
      onUserUpdate(updatedUser);
      setSecret("");
      setQrCodeDataUrl("");
      setBackupCodes([]);
      setCode("");
      setMessage("Two-factor authentication is enabled.");
      setError("");
      if (searchParams.get("next") === "/admin" && updatedUser.role === "ADMIN") {
        navigate("/admin", { replace: true });
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not verify the authentication code");
    }
  }

  async function disable(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/api/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password }) });
      setMessage("Two-factor authentication is disabled.");
      setSecret("");
      setQrCodeDataUrl("");
      setBackupCodes([]);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not disable two-factor authentication");
    }
  }

  return (
    <main className="account-security-layout">
      <aside className="login-art"><Link className="brand brand-light" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link><div className="login-art-copy"><span className="eyebrow eyebrow-light">ACCOUNT SECURITY</span><h2>Keep your<br /><em>workspace safe.</em></h2></div></aside>
      <section className="login-content"><div className="login-form-wrap">
        <div className="eyebrow">TWO-FACTOR AUTHENTICATION</div><h1>Protect your account</h1>
        <p className="muted account-intro">Add a second verification step when signing in. Store backup codes somewhere safe.</p>
        {error && <div className="alert alert-error">{error}</div>}
        {message && <div className="alert alert-success">{message}</div>}
        {user.mfaEnabled
          ? <p className="alert alert-success">Two-factor authentication is enabled for this account.</p>
          : !secret
            ? <button className="button button-dark" type="button" onClick={() => void setup()}>Create setup key</button>
            : <div className="two-factor-setup"><div className="authenticator-qr"><img src={qrCodeDataUrl} alt="Authenticator setup QR code" /><span>Scan with your authenticator app</span></div><div className="setup-key"><span>Or enter this setup key manually</span><strong>{secret}</strong></div><ol><li>Scan the QR code or add the setup key to your authenticator app.</li><li>Enter the generated 6-digit code below.</li></ol>{backupCodes.length > 0 && <div className="backup-codes"><strong>Backup codes</strong>{backupCodes.map((item) => <code key={item}>{item}</code>)}</div>}<form className="stack-form" onSubmit={verify}><label>6-digit code<input required inputMode="numeric" pattern="[0-9]{6}" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} /></label><button className="button button-dark">Enable two-factor authentication</button></form></div>}
        {user.role === "ADMIN"
          ? <p className="muted small-copy">Platform administrator accounts must keep two-factor authentication enabled.</p>
          : <form className="stack-form two-factor-disable" onSubmit={disable}><h2>Disable two-factor authentication</h2><label>Current password<PasswordInput required value={password} onChange={(event) => setPassword(event.target.value)} /></label><button className="button button-outline">Disable two-factor</button></form>}
        <p className="login-note"><Link to="/dashboard">Back to workspace</Link></p>
      </div></section>
    </main>
  );
}
