import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "../App";
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
  byType: Array<{ type: string; _count: { _all: number } }>;
}

interface ProviderHealth {
  providers: Record<string, string>;
  history: Record<string, Array<{ status: string; details: string; checkedAt: string }>>;
  operations: Record<string, number>;
}

interface AdminUser extends User {
  emailVerifiedAt: string | null;
  createdAt: string;
  organization?: { id: string; name: string } | null;
}

const settingNames: Record<string, string> = {
  WEDDING_DAILY_RATE: "Wedding events",
  VOTING_DAILY_RATE: "Voting & contests",
  GENERAL_DAILY_RATE: "General events",
};

type AdminSection = "overview" | "platform" | "people" | "operations";

const adminSections: Array<{ id: AdminSection; label: string; number: string }> = [
  { id: "overview", label: "Overview", number: "01" },
  { id: "platform", label: "Platform", number: "02" },
  { id: "people", label: "People", number: "03" },
  { id: "operations", label: "Operations", number: "04" },
];

export function AdminPanel({ user: adminUser }: { user: User }) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [loading, setLoading] = useState(true);
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
  const [users, setUsers] = useState<AdminUser[]>([]);

  async function loadAdmin() {
    setLoading(true);
    setError("");
    const failures: string[] = [];
    async function load<T>(label: string, request: Promise<T>): Promise<T | null> {
      try {
        return await request;
      } catch (reason) {
        failures.push(`${label}: ${reason instanceof Error ? reason.message : "request failed"}`);
        return null;
      }
    }

    const [settingsResult, current, inbox, logs, orgs, refundData, jobData, health, deletionData, userData] = await Promise.all([
      load("Pricing", api<{ settings: Setting[] }>("/api/admin/settings")),
      load("Overview", api<PlatformOverview>("/api/admin/overview")),
      load("Contact inbox", api<{messages:Array<{id:string;name:string;email:string;message:string;handled:boolean;createdAt:string}>}>("/api/admin/contact")),
      load("Audit history", api<{logs:Array<{id:string;action:string;entityType:string;createdAt:string;actor?:{name:string;email:string}|null}>}>("/api/admin/audit")),
      load("Organizations", api<{organizations:Array<{id:string;name:string;slug:string}>}>("/api/admin/organizations")),
      load("Refund requests", api<{refunds:typeof refunds}>("/api/admin/features/refunds")),
      load("Background jobs", api<{jobs:typeof jobs}>("/api/admin/features/jobs")),
      load("Provider health", api<ProviderHealth>("/api/admin/features/provider-health")),
      load("Privacy requests", api<{requests:typeof deletionRequests}>("/api/admin/features/data-deletion-requests")),
      load("User directory", api<{users:AdminUser[]}>("/api/admin/users")),
    ]);

    if (settingsResult) {
      setSettings(settingsResult.settings);
      setRates(Object.fromEntries(settingsResult.settings.map((setting) => [setting.key, String(setting.value)])));
    }
    if (current) setOverview(current);
    if (inbox) setContactMessages(inbox.messages);
    if (logs) setAuditLogs(logs.logs);
    if (orgs) setOrganizations(orgs.organizations);
    if (refundData) setRefunds(refundData.refunds);
    if (jobData) setJobs(jobData.jobs);
    if (health) setProviderHealth(health);
    if (deletionData) setDeletionRequests(deletionData.requests);
    if (userData) setUsers(userData.users);
    if (failures.length) setError(`Some dashboard data could not be loaded. ${failures.join(" · ")}`);
    setLoading(false);
  }

  useEffect(() => { void loadAdmin(); }, []);

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
      const { user: created } = await api<{ user: Pick<User, "id" | "name" | "email" | "role"> & { createdAt: string } }>("/api/admin/users", { method: "POST", body: JSON.stringify(user) });
      setUsers((current) => [{ ...created, emailVerifiedAt: null, organization: null }, ...current]);
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
    try {
      await api(`/api/admin/contact/${id}`, { method: "PATCH", body: JSON.stringify({ handled: true }) });
      setContactMessages((current) => current.map((item) => item.id === id ? { ...item, handled: true } : item));
      setMessage("Contact message marked handled.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update contact message"); }
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

  const pendingRefunds = refunds.filter((item) => ["REQUESTED", "APPROVED", "PROCESSING"].includes(item.status)).length;
  const failedJobs = jobs.filter((item) => ["FAILED", "DEAD"].includes(item.status)).length;
  const pendingPrivacy = deletionRequests.filter((item) => !item.completedAt).length;
  const readyProviders = Object.values(providerHealth?.providers ?? {}).filter((status) => status === "ready").length;
  const providerCount = Object.keys(providerHealth?.providers ?? {}).length;

  return <main className="app-shell admin-dashboard-shell">
    <aside className="sidebar">
      <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
      <div className="side-label">CONTROL CENTER</div>
      {adminSections.map((item) => <button key={item.id} className={`side-link side-button ${section === item.id ? "active" : ""}`} onClick={() => setSection(item.id)}><span>{item.number}</span>{item.label}</button>)}
      <div className="side-label side-spaced">PRODUCTS</div>
      <Link className="side-link" to="/dashboard"><span>↗</span> Product home</Link>
      <div className="sidebar-bottom">
        <div className="user-chip"><span className="avatar">{adminUser.name.slice(0, 1).toUpperCase()}</span><span><strong>{adminUser.name}</strong><small>Platform admin</small></span></div>
        <Link className="text-button" to="/dashboard">Return to workspace</Link>
      </div>
    </aside>
    <section className="main-content">
      <header className="topbar"><span className="breadcrumb">EventFlow <span>/</span> Control center</span><button className="button button-outline" onClick={() => void loadAdmin()} disabled={loading}>{loading ? <CubeLoader label="Refresh" compact /> : "Refresh data"}</button></header>
      <div className="page-heading admin-page-heading">
        <div><div className="eyebrow">CENTRAL ADMIN DASHBOARD</div><h1>{section === "overview" ? "Platform overview" : adminSections.find((item) => item.id === section)?.label}</h1><p>Monitor platform activity, manage operations, and keep every event running smoothly.</p></div>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {loading && !overview ? <div className="empty-panel"><CubeLoader label="Platform data" /></div> : <>
        {section === "overview" && <>
          {overview && <div className="stat-grid admin-metric-grid">
            <div className="stat-card"><span className="stat-label">Events on platform</span><strong>{overview.events}</strong><small>Across all event products</small></div>
            <div className="stat-card"><span className="stat-label">Platform accounts</span><strong>{overview.staff}</strong><small>{users.filter((item) => item.role === "EVENT_MANAGER").length} event managers</small></div>
            <div className="stat-card"><span className="stat-label">Guests & attendees</span><strong>{overview.guests}</strong><small>Registered across events</small></div>
            <div className="stat-card"><span className="stat-label">Votes recorded</span><strong>{overview.votes}</strong><small>{overview.paidOrders} paid orders</small></div>
            <div className="stat-card stat-highlight"><span className="stat-label">Recorded revenue</span><strong>{formatMoney(overview.revenue)}</strong><small>Paid ticket and vote orders</small></div>
          </div>}
          <div className="admin-overview-grid">
            <section className="content-card">
              <div className="section-heading compact"><div><div className="eyebrow">EVENTFLOW PRODUCTS</div><h2>Events by type</h2></div><button className="text-button" onClick={() => setSection("platform")}>Platform settings ↗</button></div>
              <div className="admin-product-breakdown">{(["WEDDING", "VOTING", "GENERAL"] as const).map((type) => {
                const count = overview?.byType.find((item) => item.type === type)?._count._all ?? 0;
                const total = overview?.events ?? 0;
                return <div className="admin-product-row" key={type}><div><strong>{settingNames[`${type}_DAILY_RATE`] ?? type}</strong><span>{count} {count === 1 ? "event" : "events"}</span></div><div className="admin-product-track"><span className={`admin-product-bar ${type.toLowerCase()}`} style={{ width: `${total ? Math.max((count / total) * 100, count ? 4 : 0) : 0}%` }} /></div></div>;
              })}</div>
            </section>
            <section className="content-card admin-health-card">
              <div className="eyebrow">SERVICE HEALTH</div><h2>Connected services</h2>
              {providerHealth ? <><div className="admin-health-summary"><span>{readyProviders} / {providerCount} ready</span><span>Configuration status</span></div><div className="admin-provider-summary">{Object.entries(providerHealth.providers).map(([name, status]) => <div className="admin-provider-row" key={name}><span className={`health-dot ${status}`} /><strong>{name.replace(/([A-Z])/g, " $1")}</strong><span className={`health-label ${status}`}>{status.replaceAll("_", " ")}</span></div>)}</div><small className="muted">Providers configured and database connectivity. No live delivery test was sent.</small></> : <CubeLoader label="Service health" />}
            </section>
          </div>
          <section className="content-card admin-queue-card">
            <div className="section-heading compact"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Operational queues</h2></div><button className="text-button" onClick={() => setSection("operations")}>Open operations ↗</button></div>
            <div className="admin-queue-grid">
              <button onClick={() => setSection("operations")}><span className="admin-queue-count">{overview?.contactMessages ?? 0}</span><span><strong>Contact messages</strong><small>Waiting for a response</small></span></button>
              <button onClick={() => setSection("operations")}><span className="admin-queue-count">{pendingRefunds}</span><span><strong>Refund requests</strong><small>Require review or resolution</small></span></button>
              <button onClick={() => setSection("operations")}><span className="admin-queue-count">{failedJobs}</span><span><strong>Failed jobs</strong><small>Review before retrying</small></span></button>
              <button onClick={() => setSection("operations")}><span className="admin-queue-count">{pendingPrivacy}</span><span><strong>Privacy requests</strong><small>Pending identity and policy review</small></span></button>
            </div>
          </section>
          <section className="content-card admin-recent-card">
            <div className="section-heading compact"><div><div className="eyebrow">ADMINISTRATION</div><h2>Recent platform activity</h2></div><button className="text-button" onClick={() => setSection("operations")}>View audit history ↗</button></div>
            {auditLogs.slice(0, 5).map((item) => <article className="admin-list-item admin-audit-row" key={item.id}><span className="admin-audit-mark">↗</span><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.entityType} · {item.actor?.name ?? "System"} · {new Date(item.createdAt).toLocaleString()}</small></span></article>)}
            {!auditLogs.length && <div className="empty-note">Administrative actions will appear here as they happen.</div>}
          </section>
        </>}
        {section === "platform" && <div className="admin-section-grid">
          <form className="content-card stack-form" onSubmit={saveRates}><div className="eyebrow">PRICING CONTROLS</div><h2>Daily event pricing</h2><p className="muted small-copy">Rates are applied per event day when an event is created.</p>{settings.map((setting) => <label key={setting.key}>{settingNames[setting.key] ?? setting.key}<input type="number" min="0" max="1000000000" step="0.01" required value={rates[setting.key] ?? ""} onChange={(event) => setRates({ ...rates, [setting.key]: event.target.value })} /><small className="muted">Current rate: {formatMoney(setting.value)}</small></label>)}<button className="button button-dark">Save daily rates</button></form>
          <div className="content-card"><div className="eyebrow">ORGANIZATION DIRECTORY</div><h2>Organizations</h2><form className="inline-form admin-inline-form" onSubmit={createOrganization}><input aria-label="Organization name" required minLength={2} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="New organization" /><button className="button button-dark">Create</button></form><div className="admin-directory-list">{organizations.map((organization) => <article className="admin-list-item" key={organization.id}><strong>{organization.name}</strong><small>/{organization.slug}</small></article>)}{!organizations.length && <div className="empty-note">No organizations created yet.</div>}</div></div>
          <section className="content-card admin-service-detail"><div className="eyebrow">SERVICE DIAGNOSTICS</div><h2>Provider health</h2>{providerHealth ? <><div className="provider-grid">{Object.entries(providerHealth.providers).map(([name, status]) => <article className="admin-list-item" key={name}><strong>{name.replace(/([A-Z])/g, " $1")}</strong><small className={`health-label ${status}`}>{status.replaceAll("_", " ")}</small></article>)}</div><div className="stat-grid">{Object.entries(providerHealth.operations).map(([name, value]) => <div className="stat-card" key={name}><span className="stat-label">{name.replaceAll(/([A-Z])/g, " $1")}</span><strong>{value}</strong></div>)}</div><h3>Recent provider checks</h3>{Object.entries(providerHealth.history).map(([provider, checks]) => <div className="admin-list-item" key={provider}><strong>{provider}</strong>{checks.map((check, index) => <small key={`${check.checkedAt}-${index}`}>{check.status.replaceAll("_", " ")} · {check.details} · <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString()}</time></small>)}</div>)}<p className="muted small-copy">Provider readiness reflects configuration and database connectivity, not a live delivery test.</p></> : <CubeLoader label="Providers" />}</section>
        </div>}
        {section === "people" && <div className="admin-section-grid">
          <form className="content-card stack-form" onSubmit={createUser}><div className="eyebrow">ACCESS MANAGEMENT</div><h2>Create a platform account</h2><label>Full name<input required value={user.name} onChange={(event) => setUser({ ...user, name: event.target.value })} /></label><label>Email<input type="email" required value={user.email} onChange={(event) => setUser({ ...user, email: event.target.value })} /></label><label>Temporary password<input type="password" minLength={12} required value={user.password} onChange={(event) => setUser({ ...user, password: event.target.value })} /><small className="muted">At least 12 characters. Share securely.</small></label><label>Role<select value={user.role} onChange={(event) => setUser({ ...user, role: event.target.value })}><option value="EVENT_MANAGER">Event manager</option><option value="CHECK_IN_STAFF">Check-in staff</option><option value="ADMIN">Platform administrator</option></select></label><button className="button button-dark">Create account</button></form>
          <section className="content-card admin-user-directory"><div className="eyebrow">ACCOUNT DIRECTORY</div><h2>{users.length} platform {users.length === 1 ? "account" : "accounts"}</h2><div className="admin-directory-list">{users.map((item) => <article className="admin-list-item admin-user-row" key={item.id}><span className="avatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.email} · {item.organization?.name ?? "No organization"}</small></span><span className="status-pill">{item.role.replaceAll("_", " ").toLowerCase()}</span><small>{item.emailVerifiedAt ? "Verified" : "Unverified"}</small></article>)}{!users.length && <div className="empty-note">No accounts available.</div>}</div></section>
        </div>}
        {section === "operations" && <div className="admin-operations-grid">
          <section className="content-card"><div className="eyebrow">SUPPORT</div><h2>Contact inbox</h2>{contactMessages.length ? contactMessages.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.name}</strong><small>{item.email} · {new Date(item.createdAt).toLocaleString()}</small><p>{item.message}</p>{!item.handled && <button className="text-button" onClick={() => void handleContact(item.id)}>Mark handled</button>}</article>) : <div className="empty-note">No contact messages.</div>}</section>
          <section className="content-card"><div className="eyebrow">PAYMENTS</div><h2>Refund requests <span className="heading-count">{pendingRefunds}</span></h2>{refunds.length ? refunds.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.event.title}</strong><small>{item.orderType} order · {formatMoney(item.amount, item.currency)} · {item.status}</small>{item.reason && <p>{item.reason}</p>}{item.status === "PROCESSING" && <p className="muted small-copy">Verify the provider result before resolving this request; automatic retries are blocked to prevent duplicate refunds.</p>}<div className="heading-actions">{item.status === "REQUESTED" && <><button className="text-button" onClick={() => void updateRefund(item.id, "APPROVED")}>Approve</button><button className="text-button" onClick={() => void updateRefund(item.id, "REJECTED")}>Reject</button></>}{item.status === "APPROVED" && <button className="text-button" onClick={() => void updateRefund(item.id, "COMPLETED")}>Submit refund to Paystack</button>}{item.status === "PROCESSING" && <><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "COMPLETED")}>Confirm completed</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "APPROVED")}>Retry after verification</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "REJECTED")}>Reject after verification</button></>}</div></article>) : <div className="empty-note">No refund requests.</div>}</section>
          <section className="content-card"><div className="eyebrow">RELIABILITY</div><h2>Background jobs <span className="heading-count">{failedJobs} need review</span></h2>{jobs.length ? jobs.slice(0, 30).map((item) => <article className="admin-list-item" key={item.id}><strong>{item.type}</strong><small>{item.status} · attempt {item.attempts}</small>{item.error && <p>{item.error}</p>}{["FAILED", "DEAD"].includes(item.status) && <button className="text-button" onClick={() => void retryJob(item.id)}>Retry after checking delivery</button>}</article>) : <div className="empty-note">No background jobs.</div>}</section>
          <section className="content-card"><div className="eyebrow">PRIVACY</div><h2>Data deletion requests <span className="heading-count">{pendingPrivacy} pending</span></h2><p className="muted small-copy">Verify the requester’s identity and assess legal retention requirements before marking a request fulfilled.</p>{deletionRequests.length ? deletionRequests.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.email}</strong><small>Received <time dateTime={item.requestedAt}>{new Date(item.requestedAt).toLocaleString()}</time> · {item.completedAt ? "Fulfilled" : "Pending review"}</small>{item.reason && <p>{item.reason}</p>}{!item.completedAt && <button className="text-button" onClick={() => void completeDeletionRequest(item.id)}>Mark fulfilled</button>}</article>) : <div className="empty-note">No privacy requests.</div>}</section>
          <section className="content-card admin-audit-full"><div className="eyebrow">ACCOUNTABILITY</div><h2>Audit history</h2>{auditLogs.length ? auditLogs.slice(0, 30).map((item) => <article className="admin-list-item admin-audit-row" key={item.id}><span className="admin-audit-mark">↗</span><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.entityType} · {new Date(item.createdAt).toLocaleString()} {item.actor ? `· ${item.actor.name}` : ""}</small></span></article>) : <div className="empty-note">No audit activity yet.</div>}</section>
        </div>}
      </>}
    </section>
  </main>;
}
