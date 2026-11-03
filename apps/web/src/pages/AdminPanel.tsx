import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, formatMoney } from "../api";

interface Setting {
  key: string;
  value: string;
  description?: string | null;
}

const settingNames: Record<string, string> = {
  WEDDING_DAILY_RATE: "Wedding events",
  VOTING_DAILY_RATE: "Voting & contests",
  GENERAL_DAILY_RATE: "General events",
};

export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [rates, setRates] = useState<Record<string, string>>({});
  const [user, setUser] = useState({ name: "", email: "", password: "", role: "EVENT_MANAGER" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ settings: Setting[] }>("/api/admin/settings")
      .then(({ settings: current }) => {
        setSettings(current);
        setRates(Object.fromEntries(current.map((setting) => [setting.key, String(setting.value)])));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load platform settings"));
  }, []);

  async function saveRates(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    try {
      for (const setting of settings) {
        await api(`/api/admin/settings/${setting.key}`, {
          method: "PUT",
          body: JSON.stringify({ value: Number(rates[setting.key]), description: setting.description }),
        });
      }
      setMessage("Daily event rates updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save pricing"); }
  }

  async function createUser(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(user) });
      setMessage(`Account created for ${user.email}.`);
      setUser({ name: "", email: "", password: "", role: "EVENT_MANAGER" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create account"); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="eyebrow">PLATFORM ADMINISTRATION</div><h2 id="admin-title">A thoughtful overview.</h2><p className="muted">Manage event pricing and bring your team into the workspace.</p>
    {error && <div className="alert alert-error">{error}</div>}{message && <div className="alert alert-success">{message}</div>}
    <form className="stack-form admin-form" onSubmit={saveRates}><h3>Daily event pricing</h3>{settings.map((setting) => <label key={setting.key}>{settingNames[setting.key] ?? setting.key}<input type="number" min="0" max="1000000000" step="0.01" required value={rates[setting.key] ?? ""} onChange={(event) => setRates({ ...rates, [setting.key]: event.target.value })} /><small className="muted">Current rate: {formatMoney(setting.value)}</small></label>)}<button className="button button-dark">Save daily rates</button></form>
    <form className="stack-form admin-form" onSubmit={createUser}><h3>Invite a team member</h3><label>Full name<input required value={user.name} onChange={(event) => setUser({ ...user, name: event.target.value })} /></label><label>Email<input type="email" required value={user.email} onChange={(event) => setUser({ ...user, email: event.target.value })} /></label><label>Temporary password<input type="password" minLength={12} required value={user.password} onChange={(event) => setUser({ ...user, password: event.target.value })} /><small className="muted">At least 12 characters. Share securely.</small></label><label>Role<select value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value })}><option value="EVENT_MANAGER">Event manager</option><option value="CHECK_IN_STAFF">Check-in staff</option><option value="ADMIN">Platform administrator</option></select></label><button className="button button-outline">Create account</button></form>
  </section></div>;
}
