import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, formatMoney } from "../api";
import { CubeLoader } from "../components/CubeLoader";

interface Setting {
  key: string;
  value: string;
  description?: string | null;
}

interface PlatformOverview {
  events:number;
  guests:number;
  votes:number;
  paidOrders:number;
  contactMessages:number;
  staff:number;
  revenue:string;
}

interface ProviderHealth {
  providers: Record<string, string>;
  history: Record<string, Array<{ status: string; details: string; checkedAt: string }>>;
  operations: Record<string, number>;
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
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [contactMessages, setContactMessages] = useState<Array<{id:string;name:string;email:string;message:string;handled:boolean;createdAt:string}>>([]);
  const [auditLogs, setAuditLogs] = useState<Array<{id:string;action:string;entityType:string;createdAt:string;actor?:{name:string;email:string}|null}>>([]);
  const [organizations, setOrganizations] = useState<Array<{id:string;name:string;slug:string}>>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [refunds, setRefunds] = useState<Array<{id:string;orderId:string;orderType:string;amount:string;currency:string;status:string;reason?:string|null;paymentReference?:string|null;event:{title:string}}>>([]);
  const [jobs, setJobs] = useState<Array<{id:string;type:string;status:string;attempts:number;error?:string|null}>>([]);
  const [deletionRequests, setDeletionRequests] = useState<Array<{id:string;email:string;reason:string|null;requestedAt:string;completedAt:string|null}>>([]);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | null>(null);

  useEffect(() => {
    api<{ settings: Setting[] }>("/api/admin/settings")
      .then(({ settings: current }) => {
        setSettings(current);
        setRates(Object.fromEntries(current.map((setting) => [setting.key, String(setting.value)])));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load platform settings"));
    Promise.all([
      api<PlatformOverview>("/api/admin/overview"),
      api<{messages:Array<{id:string;name:string;email:string;message:string;handled:boolean;createdAt:string}>}>("/api/admin/contact"),
      api<{logs:Array<{id:string;action:string;entityType:string;createdAt:string;actor?:{name:string;email:string}|null}>}>("/api/admin/audit"),
      api<{organizations:Array<{id:string;name:string;slug:string}>}>("/api/admin/organizations"),
      api<{refunds:typeof refunds}>("/api/admin/features/refunds"),
      api<{jobs:typeof jobs}>("/api/admin/features/jobs"),
      api<ProviderHealth>("/api/admin/features/provider-health"),
      api<{requests:typeof deletionRequests}>("/api/admin/features/data-deletion-requests"),
    ]).then(([current, inbox, logs, orgs, refundData, jobData, health, deletionData]) => {
      setOverview(current);
      setContactMessages(inbox.messages);
      setAuditLogs(logs.logs);
      setOrganizations(orgs.organizations);
      setRefunds(refundData.refunds);
      setJobs(jobData.jobs);
      setProviderHealth(health);
      setDeletionRequests(deletionData.requests);
    }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load platform tools"));
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

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await api<{organization:{id:string;name:string;slug:string}}>("/api/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ name: organizationName }),
      });
      setOrganizations((current) => [...current, result.organization]);
      setOrganizationName("");
      setMessage("Organization created.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create organization"); }
  }

  async function handleContact(id: string) {
    await api(`/api/admin/contact/${id}`, { method: "PATCH", body: JSON.stringify({ handled: true }) });
    setContactMessages((current) => current.map((item) => item.id === id ? { ...item, handled: true } : item));
  }

  async function updateRefund(id: string, status: "APPROVED" | "REJECTED" | "COMPLETED", reason?: string) {
    try {
      await api(`/api/admin/features/refunds/${id}`, { method: "PATCH", body: JSON.stringify({ status, ...(reason ? { reason } : {}) }) });
      setRefunds((current) => current.map((item) => item.id === id ? { ...item, status } : item));
      setMessage(`Refund marked ${status.toLowerCase()}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update refund"); }
  }

  function resolveProcessingRefund(id: string, status: "APPROVED" | "REJECTED" | "COMPLETED") {
    const confirmation = status === "COMPLETED"
      ? "Confirm that Paystack shows this refund as completed. This updates the order without submitting another refund."
      : status === "APPROVED"
        ? "Confirm that Paystack shows no refund for this payment. This allows a new refund attempt."
        : "Confirm that you reviewed this payment with Paystack and want to reject the refund.";
    if (!window.confirm(confirmation)) return;
    void updateRefund(id, status, "Provider status manually verified in Paystack");
  }

  async function retryJob(id: string) {
    if (!window.confirm("Verify that the job's email or SMS was not already delivered before retrying.")) return;
    try {
      await api(`/api/admin/features/jobs/${id}/retry`, { method: "PATCH" });
      setJobs((current) => current.map((item) => item.id === id ? { ...item, status: "QUEUED", attempts: 0, error: null } : item));
      setMessage("Background job queued for retry.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not retry job"); }
  }

  async function completeDeletionRequest(id: string) {
    try {
      await api(`/api/admin/features/data-deletion-requests/${id}/complete`, { method: "PATCH" });
      setDeletionRequests((current) => current.map((item) =>
        item.id === id ? { ...item, completedAt: new Date().toISOString() } : item,
      ));
      setMessage("Privacy request marked fulfilled.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update privacy request"); }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-title"><button className="modal-close" onClick={onClose} aria-label="Close">×</button><div className="eyebrow">PLATFORM ADMINISTRATION</div><h2 id="admin-title">A thoughtful overview.</h2><p className="muted">Manage event pricing and bring your team into the workspace.</p>
    {error && <div className="alert alert-error">{error}</div>}{message && <div className="alert alert-success">{message}</div>}
    <form className="stack-form admin-form" onSubmit={saveRates}><h3>Daily event pricing</h3>{settings.map((setting) => <label key={setting.key}>{settingNames[setting.key] ?? setting.key}<input type="number" min="0" max="1000000000" step="0.01" required value={rates[setting.key] ?? ""} onChange={(event) => setRates({ ...rates, [setting.key]: event.target.value })} /><small className="muted">Current rate: {formatMoney(setting.value)}</small></label>)}<button className="button button-dark">Save daily rates</button></form>
    <form className="stack-form admin-form" onSubmit={createUser}><h3>Invite a team member</h3><label>Full name<input required value={user.name} onChange={(event) => setUser({ ...user, name: event.target.value })} /></label><label>Email<input type="email" required value={user.email} onChange={(event) => setUser({ ...user, email: event.target.value })} /></label><label>Temporary password<input type="password" minLength={12} required value={user.password} onChange={(event) => setUser({ ...user, password: event.target.value })} /><small className="muted">At least 12 characters. Share securely.</small></label><label>Role<select value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value })}><option value="EVENT_MANAGER">Event manager</option><option value="CHECK_IN_STAFF">Check-in staff</option><option value="ADMIN">Platform administrator</option></select></label><button className="button button-outline">Create account</button></form>
    {overview && <div className="stat-grid"><div className="stat-card"><span className="stat-label">Platform revenue</span><strong>{formatMoney(overview.revenue)}</strong></div><div className="stat-card"><span className="stat-label">Unresolved contact</span><strong>{overview.contactMessages}</strong></div><div className="stat-card"><span className="stat-label">Team accounts</span><strong>{overview.staff}</strong></div></div>}
    <form className="stack-form admin-form" onSubmit={createOrganization}><h3>Organizations</h3><label>Organization name<input required value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} /></label><button className="button button-outline">Create organization</button><div>{organizations.map((organization) => <small className="admin-list-item" key={organization.id}>{organization.name}</small>)}</div></form>
    <div className="admin-form"><h3>Contact inbox</h3>{contactMessages.length ? contactMessages.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.name}</strong><small>{item.email}</small><p>{item.message}</p>{!item.handled && <button className="text-button" onClick={() => void handleContact(item.id)}>Mark handled</button>}</article>) : <small className="muted">No contact messages.</small>}</div>
    <div className="admin-form"><h3>Provider health</h3>{providerHealth ? <><div className="provider-grid">{Object.entries(providerHealth.providers).map(([name, status]) => <article className="admin-list-item" key={name}><strong>{name}</strong><small>{status.replaceAll("_", " ")}</small></article>)}</div><div className="stat-grid">{Object.entries(providerHealth.operations).map(([name, value]) => <div className="stat-card" key={name}><span className="stat-label">{name.replaceAll(/([A-Z])/g, " $1")}</span><strong>{value}</strong></div>)}</div><h4>Recent provider checks</h4>{Object.entries(providerHealth.history).map(([provider, checks]) => <div className="admin-list-item" key={provider}><strong>{provider}</strong>{checks.map((check, index) => <small key={`${check.checkedAt}-${index}`}>{check.status.replaceAll("_", " ")} · {check.details} · <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString()}</time></small>)}</div>)}<p className="muted small-copy">Provider readiness reflects configuration and database connectivity, not a live delivery test.</p></> : <CubeLoader label="Providers" />}</div>
    <div className="admin-form"><h3>Refund requests</h3>{refunds.length ? refunds.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.event.title}</strong><small>{item.orderType} order {item.orderId} · {formatMoney(item.amount, item.currency)} · {item.status}</small>{item.reason && <p>{item.reason}</p>}{item.status === "PROCESSING" && <p className="muted small-copy">Verify the provider result before resolving this request; automatic retries are blocked to prevent duplicate refunds.</p>}<div className="heading-actions">{item.status === "REQUESTED" && <><button className="text-button" onClick={() => void updateRefund(item.id, "APPROVED")}>Approve</button><button className="text-button" onClick={() => void updateRefund(item.id, "REJECTED")}>Reject</button></>}{item.status === "APPROVED" && <button className="text-button" onClick={() => void updateRefund(item.id, "COMPLETED")}>Submit refund to Paystack</button>}{item.status === "PROCESSING" && <><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "COMPLETED")}>Confirm completed</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "APPROVED")}>Retry after verification</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "REJECTED")}>Reject after verification</button></>}</div></article>) : <small className="muted">No refund requests.</small>}</div>
    <div className="admin-form"><h3>Background jobs</h3>{jobs.length ? jobs.slice(0, 30).map((item) => <article className="admin-list-item" key={item.id}><strong>{item.type}</strong><small>{item.status} · attempt {item.attempts}</small>{item.error && <p>{item.error}</p>}{["FAILED", "DEAD"].includes(item.status) && <button className="text-button" onClick={() => void retryJob(item.id)}>Retry</button>}</article>) : <small className="muted">No background jobs.</small>}</div>
    <div className="admin-form"><h3>Privacy requests</h3><p className="muted small-copy">Verify the requester’s identity, assess legal retention requirements, and carry out the request before marking it fulfilled. Completion is recorded in the audit history.</p>{deletionRequests.length ? deletionRequests.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.email}</strong><small>Received <time dateTime={item.requestedAt}>{new Date(item.requestedAt).toLocaleString()}</time> · {item.completedAt ? "Fulfilled" : "Pending review"}</small>{item.reason && <p>{item.reason}</p>}{!item.completedAt && <button className="text-button" onClick={() => void completeDeletionRequest(item.id)}>Mark fulfilled</button>}</article>) : <small className="muted">No privacy requests.</small>}</div>
    <div className="admin-form"><h3>Audit history</h3>{auditLogs.length ? auditLogs.slice(0, 20).map((item) => <article className="admin-list-item" key={item.id}><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.entityType} · {new Date(item.createdAt).toLocaleString()}</small>{item.actor && <small>{item.actor.name}</small>}</article>) : <small className="muted">No audit activity yet.</small>}</div>
  </section></div>;
}
