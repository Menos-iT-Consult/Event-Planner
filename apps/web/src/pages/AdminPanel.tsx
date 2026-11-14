import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import type { User } from "../App";
import { api, formatMoney } from "../api";
import { CubeLoader } from "../components/CubeLoader";
import { MobileMenuButton } from "../components/MobileMenuButton";

interface Setting {
  key: string;
  value: string;
  description?: string | null;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  interval: "MONTHLY" | "YEARLY";
  features: string[];
  maxEvents: number | null;
  maxMembers: number | null;
  active: boolean;
}

interface PlatformOverview {
  days: number;
  since: string;
  activeEvents: number;
  upcomingEvents: number;
  newEvents: number;
  previousEvents: number;
  newAccounts: number;
  previousAccounts: number;
  eventsByType: Array<{ type: string; _count: { _all: number } }>;
  revenueByCurrency: Array<{
    currency: string;
    tickets: string;
    votes: string;
    subscriptions: string;
    refunds: string;
    paidOrders: number;
    net: string;
  }>;
  queues: { openContacts: number; failedJobs: number; pendingPrivacy: number };
  recentActivity: AuditEntry[];
}

interface ProviderHealth {
  providers: Record<string, string>;
  history: Record<string, Array<{ status: string; details: string; checkedAt: string }>>;
  operations: Record<string, number>;
}

interface AdminUser extends User {
  emailVerifiedAt: string | null;
  disabledAt: string | null;
  disabledReason: string | null;
  mfaEnabled: boolean;
  createdAt: string;
  organization?: { id: string; name: string } | null;
}

interface AdminEvent {
  id: string;
  slug: string;
  title: string;
  type: "WEDDING" | "VOTING" | "GENERAL";
  startDate: string;
  endDate: string;
  currency: string;
  isPublished: boolean;
  organization: { id: string; name: string };
  _count: { guests: number; orders: number };
}

interface AdminOrganization {
  id: string;
  name: string;
  slug: string;
  _count: { memberships: number; events: number };
  owner: { id: string; name: string; email: string } | null;
  subscription: { status: string; currentPeriodEnd: string; plan: { name: string } } | null;
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: unknown;
  createdAt: string;
  actor: { name: string; email: string } | null;
}

const settingNames: Record<string, string> = {
  WEDDING_DAILY_RATE: "Wedding events",
  VOTING_DAILY_RATE: "Voting & contests",
  GENERAL_DAILY_RATE: "General events",
};
const dailyRateKeys = ["WEDDING_DAILY_RATE", "VOTING_DAILY_RATE", "GENERAL_DAILY_RATE"] as const;

function formatCountDelta(current: number, previous: number) {
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${delta} vs previous period`;
}

type AdminSection = "overview" | "events" | "organizations" | "people" | "billing" | "operations" | "audit" | "settings";

const adminSections: Array<{ id: AdminSection; label: string; number: string }> = [
  { id: "overview", label: "Overview", number: "01" },
  { id: "events", label: "Events", number: "02" },
  { id: "organizations", label: "Organizations", number: "03" },
  { id: "people", label: "People & access", number: "04" },
  { id: "billing", label: "Billing & pricing", number: "05" },
  { id: "operations", label: "Operations", number: "06" },
  { id: "audit", label: "Audit log", number: "07" },
  { id: "settings", label: "Settings & health", number: "08" },
];

export function AdminPanel({ user: adminUser }: { user: User }) {
  const [section, setSection] = useState<AdminSection>("overview");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rangeDays, setRangeDays] = useState(30);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [subscriptionPlans, setSubscriptionPlans] = useState<SubscriptionPlan[]>([]);
  const [editingPlanId, setEditingPlanId] = useState("");
  const [planDraft, setPlanDraft] = useState({
    name: "",
    description: "",
    price: "",
    interval: "MONTHLY" as "MONTHLY" | "YEARLY",
    features: "",
    maxEvents: "",
    maxMembers: "",
    active: true,
  });
  const [rates, setRates] = useState<Record<string, string>>({});
  const [inviteDraft, setInviteDraft] = useState({ name: "", email: "", role: "EVENT_MANAGER" as "EVENT_MANAGER" | "CHECK_IN_STAFF" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [overview, setOverview] = useState<PlatformOverview | null>(null);
  const [contactMessages, setContactMessages] = useState<Array<{id:string;name:string;email:string;message:string;handled:boolean;createdAt:string}>>([]);
  const [auditLogs, setAuditLogs] = useState<AuditEntry[]>([]);
  const [auditSearchInput, setAuditSearchInput] = useState("");
  const [auditQuery, setAuditQuery] = useState("");
  const [auditPage, setAuditPage] = useState(1);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditPageCount, setAuditPageCount] = useState(0);
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [eventSearchInput, setEventSearchInput] = useState("");
  const [eventQuery, setEventQuery] = useState("");
  const [eventTypeFilter, setEventTypeFilter] = useState("");
  const [eventStatusFilter, setEventStatusFilter] = useState<"all" | "active" | "upcoming" | "past" | "published" | "unpublished">("all");
  const [eventPage, setEventPage] = useState(1);
  const [eventTotal, setEventTotal] = useState(0);
  const [eventPageCount, setEventPageCount] = useState(0);
  const [organizations, setOrganizations] = useState<AdminOrganization[]>([]);
  const [organizationName, setOrganizationName] = useState("");
  const [refunds, setRefunds] = useState<Array<{id:string;orderId:string;orderType:string;amount:string;currency:string;status:string;reason?:string|null;paymentReference?:string|null;event:{title:string}}>>([]);
  const [jobs, setJobs] = useState<Array<{id:string;type:string;status:string;attempts:number;error?:string|null}>>([]);
  const [deletionRequests, setDeletionRequests] = useState<Array<{id:string;email:string;reason:string|null;requestedAt:string;completedAt:string|null}>>([]);
  const [providerHealth, setProviderHealth] = useState<ProviderHealth | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userSearchInput, setUserSearchInput] = useState("");
  const [userQuery, setUserQuery] = useState("");
  const [userPage, setUserPage] = useState(1);
  const [userTotal, setUserTotal] = useState(0);
  const [userPageCount, setUserPageCount] = useState(0);
  const [operationsQueue, setOperationsQueue] = useState<"all" | "contact" | "refunds" | "jobs" | "privacy">("all");

  async function loadAdmin(targetSection: AdminSection = section) {
    setLoading(true);
    setError("");
    try {
      if (targetSection === "overview") {
        setOverview(await api<PlatformOverview>(`/api/admin/overview?days=${rangeDays}`));
      } else if (targetSection === "events") {
        const query = new URLSearchParams({ page: String(eventPage), limit: "25", status: eventStatusFilter });
        if (eventQuery) query.set("q", eventQuery);
        if (eventTypeFilter) query.set("type", eventTypeFilter);
        const result = await api<{ events: AdminEvent[]; total: number; pageCount: number }>(`/api/admin/events?${query}`);
        setEvents(result.events);
        setEventTotal(result.total);
        setEventPageCount(result.pageCount);
      } else if (targetSection === "organizations") {
        const result = await api<{ organizations: AdminOrganization[] }>("/api/admin/organizations");
        setOrganizations(result.organizations);
      } else if (targetSection === "people") {
        const query = new URLSearchParams({ page: String(userPage), limit: "25" });
        if (userQuery) query.set("q", userQuery);
        const result = await api<{ users: AdminUser[]; total: number; pageCount: number }>(`/api/admin/users?${query}`);
        setUsers(result.users);
        setUserTotal(result.total);
        setUserPageCount(result.pageCount);
      } else if (targetSection === "billing") {
        const [settingsResult, plansResult, current] = await Promise.all([
          api<{ settings: Setting[] }>("/api/admin/settings"),
          api<{ plans: SubscriptionPlan[] }>("/api/admin/subscription-plans"),
          api<PlatformOverview>(`/api/admin/overview?days=${rangeDays}`),
        ]);
        setSettings(settingsResult.settings);
        setRates(Object.fromEntries(dailyRateKeys.map((key) => [
          key,
          String(settingsResult.settings.find((setting) => setting.key === key)?.value ?? ""),
        ])));
        setSubscriptionPlans(plansResult.plans);
        setOverview(current);
      } else if (targetSection === "operations") {
        const queues = operationsQueue === "all" ? ["contact", "refunds", "jobs", "privacy"] : [operationsQueue];
        await Promise.all(queues.map(async (queue) => {
          if (queue === "contact") {
            const result = await api<{ messages: typeof contactMessages }>("/api/admin/contact?handled=false");
            setContactMessages(result.messages);
          } else if (queue === "refunds") {
            const result = await api<{ refunds: typeof refunds }>("/api/admin/features/refunds");
            setRefunds(result.refunds);
          } else if (queue === "jobs") {
            const result = await api<{ jobs: typeof jobs }>("/api/admin/features/jobs");
            setJobs(result.jobs);
          } else {
            const result = await api<{ requests: typeof deletionRequests }>("/api/admin/features/data-deletion-requests");
            setDeletionRequests(result.requests);
          }
        }));
      } else if (targetSection === "audit") {
        const query = new URLSearchParams({ page: String(auditPage), limit: "50" });
        if (auditQuery) query.set("q", auditQuery);
        const result = await api<{ logs: AuditEntry[]; total: number; pageCount: number }>(`/api/admin/audit?${query}`);
        setAuditLogs(result.logs);
        setAuditTotal(result.total);
        setAuditPageCount(result.pageCount);
      } else if (targetSection === "settings") {
        setProviderHealth(await api<ProviderHealth>("/api/admin/features/provider-health"));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load admin data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAdmin(section);
  }, [section, rangeDays, eventQuery, eventTypeFilter, eventStatusFilter, eventPage, userQuery, userPage, auditQuery, auditPage, operationsQueue]);

  async function saveRates(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    try {
      for (const key of dailyRateKeys) {
        await api(`/api/admin/settings/${key}`, {
          method: "PUT",
          body: JSON.stringify({ value: Number(rates[key]), description: `Daily rate for ${settingNames[key].toLowerCase()}` }),
        });
      }
      await loadAdmin("billing");
      setMessage("Daily event rates updated.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save pricing"); }
  }

  function selectPlan(planId: string) {
    setEditingPlanId(planId);
    const plan = subscriptionPlans.find((item) => item.id === planId);
    setPlanDraft(plan
      ? {
          name: plan.name,
          description: plan.description ?? "",
          price: String(plan.price),
          interval: plan.interval,
          features: plan.features.join(", "),
          maxEvents: plan.maxEvents === null ? "" : String(plan.maxEvents),
          maxMembers: plan.maxMembers === null ? "" : String(plan.maxMembers),
          active: plan.active,
        }
      : {
          name: "",
          description: "",
          price: "",
          interval: "MONTHLY",
          features: "",
          maxEvents: "",
          maxMembers: "",
          active: true,
        });
  }

  async function saveSubscriptionPlan(event: FormEvent) {
    event.preventDefault();
    setMessage("");
    setError("");
    const payload = {
      name: planDraft.name,
      description: planDraft.description || undefined,
      price: Number(planDraft.price),
      currency: "GHS",
      interval: planDraft.interval,
      features: planDraft.features.split(",").map((feature) => feature.trim()).filter(Boolean),
      maxEvents: planDraft.maxEvents === "" ? null : Number(planDraft.maxEvents),
      maxMembers: planDraft.maxMembers === "" ? null : Number(planDraft.maxMembers),
      active: planDraft.active,
    };
    try {
      const result = await api<{plan:SubscriptionPlan}>(`/api/admin/subscription-plans${editingPlanId ? `/${editingPlanId}` : ""}`, {
        method: editingPlanId ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });
      setSubscriptionPlans((current) => editingPlanId
        ? current.map((plan) => plan.id === result.plan.id ? result.plan : plan)
        : [...current, result.plan]);
      setEditingPlanId(result.plan.id);
      setMessage(`Subscription plan ${editingPlanId ? "updated" : "created"}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save subscription plan");
    }
  }

  async function inviteUser(event: FormEvent) {
    event.preventDefault(); setMessage(""); setError("");
    try {
      await api("/api/admin/users/invite", { method: "POST", body: JSON.stringify(inviteDraft) });
      setInviteDraft({ name: "", email: "", role: "EVENT_MANAGER" });
      await loadAdmin("people");
      setMessage(`Invitation queued for ${inviteDraft.email}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not invite user"); }
  }

  async function sendPasswordReset(user: AdminUser) {
    if (!window.confirm(`Send a password reset link to ${user.email}?`)) return;
    try {
      await api(`/api/admin/users/${user.id}/password-reset`, { method: "POST" });
      setMessage(`Password reset email queued for ${user.email}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not request password reset"); }
  }

  async function setUserDisabled(user: AdminUser, disabled: boolean) {
    const reason = disabled ? window.prompt(`Why are you disabling ${user.email}?`) : undefined;
    if (disabled && reason === null) return;
    if (!window.confirm(`${disabled ? "Disable" : "Re-enable"} ${user.email}?`)) return;
    try {
      const { user: updated } = await api<{ user: Pick<AdminUser, "id" | "disabledAt" | "disabledReason"> }>(
        `/api/admin/users/${user.id}/status`,
        { method: "PATCH", body: JSON.stringify({ disabled, reason: reason || undefined }) },
      );
      setUsers((current) => current.map((item) => item.id === user.id
        ? { ...item, disabledAt: updated.disabledAt, disabledReason: updated.disabledReason }
        : item));
      setMessage(`${user.email} was ${disabled ? "disabled" : "re-enabled"}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update account status"); }
  }

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    try {
      await api<{organization:{id:string;name:string;slug:string}}>("/api/admin/organizations", {
        method: "POST",
        body: JSON.stringify({ name: organizationName }),
      });
      await loadAdmin("organizations");
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
    <aside className={`sidebar${mobileMenuOpen ? " mobile-open" : ""}`} id="workspace-navigation">
      <Link className="brand" to="/dashboard" onClick={() => setMobileMenuOpen(false)}><span className="brand-mark">e</span> eventflow</Link>
      <MobileMenuButton open={mobileMenuOpen} onClick={() => setMobileMenuOpen((open) => !open)} controls="workspace-navigation" />
      <div className="side-label">CONTROL CENTER</div>
      {adminSections.map((item) => <button key={item.id} className={`side-link side-button ${section === item.id ? "active" : ""}`} onClick={() => { setSection(item.id); setMobileMenuOpen(false); }}><span>{item.number}</span>{item.label}</button>)}
      <div className="side-label side-spaced">PRODUCTS</div>
      <Link className="side-link" to="/dashboard" onClick={() => setMobileMenuOpen(false)}><span>↗</span> Product home</Link>
      <Link className="side-link" to="/organizations" onClick={() => setMobileMenuOpen(false)}><span>OR</span> Organizations</Link>
      <div className="sidebar-bottom">
        <div className="user-chip"><span className="avatar">{adminUser.name.slice(0, 1).toUpperCase()}</span><span><strong>{adminUser.name}</strong><small>Platform admin</small></span></div>
        <Link className="text-button" to="/dashboard" onClick={() => setMobileMenuOpen(false)}>Return to workspace</Link>
      </div>
    </aside>
    <section className="main-content">
      <header className="topbar"><span className="breadcrumb">EventFlow <span>/</span> Control center</span><button className="button button-outline" onClick={() => void loadAdmin()} disabled={loading}>{loading ? <CubeLoader label="Refresh" compact /> : "Refresh data"}</button></header>
      <div className="page-heading admin-page-heading">
        <div><div className="eyebrow">CENTRAL ADMIN DASHBOARD</div><h1>{section === "overview" ? "Platform overview" : adminSections.find((item) => item.id === section)?.label}</h1><p>Monitor platform activity, manage operations, and keep every event running smoothly.</p></div>
      </div>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {message && <div className="alert alert-success" role="status">{message}</div>}
      {loading ? <div className="empty-panel"><CubeLoader label="Platform data" /></div> : <>
        {section === "overview" && overview && <>
          <div className="section-heading compact admin-overview-controls">
            <p className="muted">Activity and net revenue for the selected period. Revenue is separated by currency.</p>
            <label>Period<select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>
          </div>
          <div className="stat-grid admin-metric-grid">
            <div className="stat-card"><span className="stat-label">Active events today</span><strong>{overview.activeEvents}</strong><small>{overview.upcomingEvents} upcoming in the next {overview.days} days</small></div>
            <div className="stat-card"><span className="stat-label">New events</span><strong>{overview.newEvents}</strong><small>{formatCountDelta(overview.newEvents, overview.previousEvents)} · previous {overview.days} days</small></div>
            <div className="stat-card"><span className="stat-label">New accounts</span><strong>{overview.newAccounts}</strong><small>{formatCountDelta(overview.newAccounts, overview.previousAccounts)} · previous {overview.days} days</small></div>
            {overview.revenueByCurrency.map((revenue) => <div className="stat-card stat-highlight" key={revenue.currency}><span className="stat-label">Net revenue · {revenue.currency}</span><strong>{formatMoney(revenue.net, revenue.currency)}</strong><small>{revenue.paidOrders} paid orders in {overview.days} days</small></div>)}
          </div>
          <div className="admin-overview-grid">
            <section className="content-card">
              <div className="section-heading compact"><div><div className="eyebrow">EVENTFLOW PRODUCTS</div><h2>New events by type</h2></div><button className="text-button" onClick={() => setSection("events")}>Browse events ↗</button></div>
              <div className="admin-product-breakdown">{(["WEDDING", "VOTING", "GENERAL"] as const).map((type) => {
                const count = overview.eventsByType.find((item) => item.type === type)?._count._all ?? 0;
                const total = overview.eventsByType.reduce((sum, item) => sum + item._count._all, 0);
                return <div className="admin-product-row" key={type}><div><strong>{settingNames[`${type}_DAILY_RATE`] ?? type}</strong><span>{count} {count === 1 ? "event" : "events"}</span></div><div className="admin-product-track"><span className={`admin-product-bar ${type.toLowerCase()}`} style={{ width: `${total ? Math.max((count / total) * 100, count ? 4 : 0) : 0}%` }} /></div></div>;
              })}</div>
            </section>
            <section className="content-card admin-queue-card">
              <div className="section-heading compact"><div><div className="eyebrow">NEEDS ATTENTION</div><h2>Operational queues</h2></div><button className="text-button" onClick={() => setSection("operations")}>Open operations ↗</button></div>
              <div className="admin-queue-grid">
                <button onClick={() => { setOperationsQueue("contact"); setSection("operations"); }}><span className="admin-queue-count">{overview.queues.openContacts}</span><span><strong>Contact messages</strong><small>Waiting for a response</small></span></button>
                <button onClick={() => { setOperationsQueue("jobs"); setSection("operations"); }}><span className="admin-queue-count">{overview.queues.failedJobs}</span><span><strong>Failed jobs</strong><small>Review before retrying</small></span></button>
                <button onClick={() => { setOperationsQueue("privacy"); setSection("operations"); }}><span className="admin-queue-count">{overview.queues.pendingPrivacy}</span><span><strong>Privacy requests</strong><small>Pending review</small></span></button>
              </div>
            </section>
          </div>
          <section className="content-card admin-recent-card">
            <div className="section-heading compact"><div><div className="eyebrow">ACCOUNTABILITY</div><h2>Recent platform activity</h2></div><button className="text-button" onClick={() => setSection("audit")}>Open audit log ↗</button></div>
            {overview.recentActivity.map((item) => <article className="admin-list-item admin-audit-row" key={item.id}><span className="admin-audit-mark">↗</span><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.entityType} · {item.actor?.name ?? "System"} · {new Date(item.createdAt).toLocaleString()}</small></span></article>)}
            {!overview.recentActivity.length && <div className="empty-note">Administrative actions will appear here as they happen.</div>}
          </section>
        </>}
        {section === "events" && <section className="content-card">
          <div className="eyebrow">EVENT DIRECTORY</div><h2>{eventTotal} events</h2>
          <form className="inline-form admin-inline-form" onSubmit={(event) => { event.preventDefault(); setEventPage(1); setEventQuery(eventSearchInput.trim()); }}>
            <input aria-label="Search events" value={eventSearchInput} onChange={(event) => setEventSearchInput(event.target.value)} placeholder="Search title, slug, or organization" />
            <select aria-label="Event type" value={eventTypeFilter} onChange={(event) => { setEventTypeFilter(event.target.value); setEventPage(1); }}><option value="">All event types</option><option value="WEDDING">Wedding</option><option value="VOTING">Voting & contests</option><option value="GENERAL">General</option></select>
            <select aria-label="Event status" value={eventStatusFilter} onChange={(event) => { setEventStatusFilter(event.target.value as typeof eventStatusFilter); setEventPage(1); }}><option value="all">All statuses</option><option value="active">Active now</option><option value="upcoming">Upcoming</option><option value="past">Past</option><option value="published">Published</option><option value="unpublished">Unpublished</option></select>
            <button className="button button-dark">Search</button>
          </form>
          <div className="admin-directory-list">{events.map((item) => <article className="admin-list-item admin-event-row" key={item.id}>
            <span><strong>{item.title}</strong><small>{item.type} · {item.organization.name} · {new Date(item.startDate).toLocaleDateString()} – {new Date(item.endDate).toLocaleDateString()}</small></span>
            <span className="status-pill">{item.isPublished ? "Published" : "Unpublished"}</span>
            <small>{item._count.guests} guests · {item._count.orders} orders</small>
            <span className="heading-actions"><Link className="text-button" to={`/events/${item.id}`}>Manage</Link><a className="text-button" href={`/e/${item.slug}`} target="_blank" rel="noreferrer">Public page ↗</a></span>
          </article>)}{!events.length && <div className="empty-note">No events match these filters.</div>}</div>
          <div className="admin-pagination"><span>Page {eventPage} of {Math.max(eventPageCount, 1)}</span><button className="button button-outline" disabled={eventPage <= 1} onClick={() => setEventPage((page) => page - 1)}>Previous</button><button className="button button-outline" disabled={eventPage >= eventPageCount} onClick={() => setEventPage((page) => page + 1)}>Next</button></div>
        </section>}
        {section === "organizations" && <div className="admin-section-grid">
          <section className="content-card">
            <div className="eyebrow">ORGANIZATION DIRECTORY</div><h2>{organizations.length} organizations</h2>
            <form className="inline-form admin-inline-form" onSubmit={createOrganization}><input aria-label="Organization name" required minLength={2} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="New organization" /><button className="button button-dark">Create organization</button></form>
            <div className="admin-directory-list">{organizations.map((organization) => <article className="admin-list-item" key={organization.id}>
              <span><strong>{organization.name}</strong><small>/{organization.slug} · {organization._count.memberships} members · {organization._count.events} events</small></span>
              <span><strong>{organization.owner?.name ?? "No owner"}</strong><small>{organization.owner?.email ?? "Owner not assigned"}</small></span>
              <span className="status-pill">{organization.subscription?.status ?? "No subscription"}</span>
              <small>{organization.subscription?.plan.name ?? "No plan"}{organization.subscription?.currentPeriodEnd ? ` · renews ${new Date(organization.subscription.currentPeriodEnd).toLocaleDateString()}` : ""}</small>
            </article>)}{!organizations.length && <div className="empty-note">No organizations created yet.</div>}</div>
          </section>
        </div>}
        {section === "people" && <div className="admin-section-grid">
          <form className="content-card stack-form" onSubmit={(event) => void inviteUser(event)}>
            <div className="eyebrow">ACCESS MANAGEMENT</div><h2>Invite a team member</h2><p className="muted small-copy">They will set their own password using a secure email invitation. Platform administrator access is managed outside this form.</p>
            <label>Full name<input required maxLength={120} value={inviteDraft.name} onChange={(event) => setInviteDraft({ ...inviteDraft, name: event.target.value })} /></label>
            <label>Email<input type="email" required value={inviteDraft.email} onChange={(event) => setInviteDraft({ ...inviteDraft, email: event.target.value })} /></label>
            <label>Role<select value={inviteDraft.role} onChange={(event) => setInviteDraft({ ...inviteDraft, role: event.target.value as typeof inviteDraft.role })}><option value="EVENT_MANAGER">Event manager</option><option value="CHECK_IN_STAFF">Check-in staff</option></select></label>
            <button className="button button-dark">Send invitation</button>
          </form>
          <section className="content-card admin-user-directory">
            <div className="eyebrow">ACCOUNT GOVERNANCE</div><h2>{userTotal} platform accounts</h2>
            <form className="inline-form admin-inline-form" onSubmit={(event) => { event.preventDefault(); setUserPage(1); setUserQuery(userSearchInput.trim()); }}><input aria-label="Search accounts" value={userSearchInput} onChange={(event) => setUserSearchInput(event.target.value)} placeholder="Search name or email" /><button className="button button-dark">Search</button></form>
            <div className="admin-directory-list">{users.map((item) => <article className="admin-list-item admin-user-row" key={item.id}>
              <span className="avatar">{item.name.slice(0, 1).toUpperCase()}</span>
              <span><strong>{item.name}</strong><small>{item.email} · {item.organization?.name ?? "No organization"}</small></span>
              <span className="status-pill">{item.role.replaceAll("_", " ").toLowerCase()}</span>
              <span><small>{item.emailVerifiedAt ? "Email verified" : "Email unverified"} · {item.mfaEnabled ? "MFA enabled" : "MFA not enabled"}</small><small>{item.disabledAt ? `Disabled ${new Date(item.disabledAt).toLocaleDateString()}` : "Account active"}</small></span>
              <span className="heading-actions"><button className="text-button" onClick={() => void sendPasswordReset(item)}>Send reset email</button><button className="text-button" onClick={() => void setUserDisabled(item, !item.disabledAt)}>{item.disabledAt ? "Re-enable" : "Disable"}</button></span>
            </article>)}{!users.length && <div className="empty-note">No accounts match this search.</div>}</div>
            <div className="admin-pagination"><span>Page {userPage} of {Math.max(userPageCount, 1)}</span><button className="button button-outline" disabled={userPage <= 1} onClick={() => setUserPage((page) => page - 1)}>Previous</button><button className="button button-outline" disabled={userPage >= userPageCount} onClick={() => setUserPage((page) => page + 1)}>Next</button></div>
          </section>
        </div>}
        {section === "billing" && <div className="admin-section-grid">
          <form className="content-card stack-form" onSubmit={saveRates}><div className="eyebrow">PRICING CONTROLS</div><h2>Daily event pricing</h2><p className="muted small-copy">Rates are applied per event day when an event is created. Configure all three rates before creating events.</p>{dailyRateKeys.map((key) => {
            const setting = settings.find((item) => item.key === key);
            return <label key={key}>{settingNames[key]}<input type="number" min="0" max="1000000000" step="0.01" required value={rates[key] ?? ""} onChange={(event) => setRates({ ...rates, [key]: event.target.value })} /><small className="muted">{setting ? `Current rate: ${formatMoney(setting.value)}` : "Not configured yet"}</small></label>;
          })}<button className="button button-dark">Save daily rates</button></form>
          <form className="content-card stack-form" onSubmit={(event) => void saveSubscriptionPlan(event)}>
            <div className="eyebrow">SUBSCRIPTION PRICING</div><h2>Organization plans</h2>
            <label>Edit plan<select value={editingPlanId} onChange={(event) => selectPlan(event.target.value)}><option value="">Create a new plan</option>{subscriptionPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}{plan.active ? "" : " (inactive)"}</option>)}</select></label>
            <label>Plan name<input required minLength={2} maxLength={100} value={planDraft.name} onChange={(event) => setPlanDraft({ ...planDraft, name: event.target.value })} /></label>
            <label>Description<input maxLength={500} value={planDraft.description} onChange={(event) => setPlanDraft({ ...planDraft, description: event.target.value })} /></label>
            <label>Price (GHS)<input type="number" min="0" step="0.01" required value={planDraft.price} onChange={(event) => setPlanDraft({ ...planDraft, price: event.target.value })} /></label>
            <label>Billing interval<select value={planDraft.interval} onChange={(event) => setPlanDraft({ ...planDraft, interval: event.target.value as typeof planDraft.interval })}><option value="MONTHLY">Monthly</option><option value="YEARLY">Yearly</option></select></label>
            <label>Included features<input value={planDraft.features} onChange={(event) => setPlanDraft({ ...planDraft, features: event.target.value })} placeholder="Feature one, Feature two" /><small className="muted">Separate features with commas.</small></label>
            <label>Maximum events<input type="number" min="1" step="1" value={planDraft.maxEvents} onChange={(event) => setPlanDraft({ ...planDraft, maxEvents: event.target.value })} /><small className="muted">Leave empty for no limit.</small></label>
            <label>Maximum organization members<input type="number" min="1" step="1" value={planDraft.maxMembers} onChange={(event) => setPlanDraft({ ...planDraft, maxMembers: event.target.value })} /><small className="muted">Leave empty for no limit.</small></label>
            <label className="checkbox-label"><input type="checkbox" checked={planDraft.active} onChange={(event) => setPlanDraft({ ...planDraft, active: event.target.checked })} /> Available for new subscriptions</label>
            <button className="button button-dark">{editingPlanId ? "Save plan changes" : "Create subscription plan"}</button>
          </form>
          <section className="content-card"><div className="eyebrow">REVENUE</div><h2>Paid activity</h2><label>Revenue period<select value={rangeDays} onChange={(event) => setRangeDays(Number(event.target.value))}><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option></select></label>{overview?.revenueByCurrency.map((item) => <article className="admin-list-item" key={item.currency}><strong>{formatMoney(item.net, item.currency)} net · {item.currency}</strong><small>{item.paidOrders} paid orders · {formatMoney(item.tickets, item.currency)} tickets · {formatMoney(item.votes, item.currency)} votes · {formatMoney(item.subscriptions, item.currency)} subscriptions · {formatMoney(item.refunds, item.currency)} refunds</small></article>)}{!overview?.revenueByCurrency.length && <div className="empty-note">No paid activity in this period.</div>}</section>
        </div>}
        {section === "operations" && <section className="content-card">
          <div className="eyebrow">OPERATIONAL QUEUES</div><h2>Review outstanding work</h2>
          <div className="admin-queue-filters">{(["all", "contact", "refunds", "jobs", "privacy"] as const).map((queue) => <button key={queue} className={`button ${operationsQueue === queue ? "button-dark" : "button-outline"}`} onClick={() => setOperationsQueue(queue)}>{queue === "all" ? "All queues" : queue === "contact" ? "Contact" : queue === "refunds" ? "Refunds" : queue === "jobs" ? "Jobs" : "Privacy"}</button>)}</div>
          <div className="admin-operations-grid">
            {(operationsQueue === "all" || operationsQueue === "contact") && <section className="content-card"><div className="eyebrow">SUPPORT</div><h2>Contact inbox</h2>{contactMessages.length ? contactMessages.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.name}</strong><small>{item.email} · {new Date(item.createdAt).toLocaleString()}</small><p>{item.message}</p>{!item.handled && <button className="text-button" onClick={() => void handleContact(item.id)}>Mark handled</button>}</article>) : <div className="empty-note">No open contact messages.</div>}</section>}
            {(operationsQueue === "all" || operationsQueue === "refunds") && <section className="content-card"><div className="eyebrow">PAYMENTS</div><h2>Refund requests <span className="heading-count">{pendingRefunds}</span></h2>{refunds.length ? refunds.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.event.title}</strong><small>{item.orderType} order · {formatMoney(item.amount, item.currency)} · {item.status}</small>{item.reason && <p>{item.reason}</p>}{item.status === "PROCESSING" && <p className="muted small-copy">Verify the provider result before resolving this request; automatic retries are blocked to prevent duplicate refunds.</p>}<div className="heading-actions">{item.status === "REQUESTED" && <><button className="text-button" onClick={() => void updateRefund(item.id, "APPROVED")}>Approve</button><button className="text-button" onClick={() => void updateRefund(item.id, "REJECTED")}>Reject</button></>}{item.status === "APPROVED" && <button className="text-button" onClick={() => void updateRefund(item.id, "COMPLETED")}>Submit refund to Paystack</button>}{item.status === "PROCESSING" && <><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "COMPLETED")}>Confirm completed</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "APPROVED")}>Retry after verification</button><button className="text-button" onClick={() => resolveProcessingRefund(item.id, "REJECTED")}>Reject after verification</button></>}</div></article>) : <div className="empty-note">No refund requests.</div>}</section>}
            {(operationsQueue === "all" || operationsQueue === "jobs") && <section className="content-card"><div className="eyebrow">RELIABILITY</div><h2>Background jobs <span className="heading-count">{failedJobs} need review</span></h2>{jobs.length ? jobs.slice(0, 30).map((item) => <article className="admin-list-item" key={item.id}><strong>{item.type}</strong><small>{item.status} · attempt {item.attempts}</small>{item.error && <p>{item.error}</p>}{["FAILED", "DEAD"].includes(item.status) && <button className="text-button" onClick={() => void retryJob(item.id)}>Retry after checking delivery</button>}</article>) : <div className="empty-note">No failed or pending jobs.</div>}</section>}
            {(operationsQueue === "all" || operationsQueue === "privacy") && <section className="content-card"><div className="eyebrow">PRIVACY</div><h2>Data deletion requests <span className="heading-count">{pendingPrivacy} pending</span></h2><p className="muted small-copy">Verify the requester’s identity and assess legal retention requirements before marking a request fulfilled.</p>{deletionRequests.length ? deletionRequests.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.email}</strong><small>Received <time dateTime={item.requestedAt}>{new Date(item.requestedAt).toLocaleString()}</time> · {item.completedAt ? "Fulfilled" : "Pending review"}</small>{item.reason && <p>{item.reason}</p>}{!item.completedAt && <button className="text-button" onClick={() => void completeDeletionRequest(item.id)}>Mark fulfilled</button>}</article>) : <div className="empty-note">No pending privacy requests.</div>}</section>}
          </div>
        </section>}
        {section === "audit" && <section className="content-card admin-audit-full">
          <div className="eyebrow">ACCOUNTABILITY</div><h2>{auditTotal} audit entries</h2>
          <form className="inline-form admin-inline-form" onSubmit={(event) => { event.preventDefault(); setAuditPage(1); setAuditQuery(auditSearchInput.trim()); }}><input aria-label="Search audit log" value={auditSearchInput} onChange={(event) => setAuditSearchInput(event.target.value)} placeholder="Search action, entity, ID, or actor" /><button className="button button-dark">Search audit log</button></form>
          {auditLogs.length ? auditLogs.map((item) => <article className="admin-list-item admin-audit-row" key={item.id}><span className="admin-audit-mark">↗</span><span><strong>{item.action.replaceAll("_", " ")}</strong><small>{item.entityType}{item.entityId ? ` · ${item.entityId}` : ""} · {new Date(item.createdAt).toLocaleString()} · {item.actor?.name ?? "System"}{item.actor ? ` (${item.actor.email})` : ""}</small></span></article>) : <div className="empty-note">No audit entries match this search.</div>}
          <div className="admin-pagination"><span>Page {auditPage} of {Math.max(auditPageCount, 1)}</span><button className="button button-outline" disabled={auditPage <= 1} onClick={() => setAuditPage((page) => page - 1)}>Previous</button><button className="button button-outline" disabled={auditPage >= auditPageCount} onClick={() => setAuditPage((page) => page + 1)}>Next</button></div>
        </section>}
        {section === "settings" && <section className="content-card admin-service-detail">
          <div className="eyebrow">SERVICE DIAGNOSTICS</div><h2>Settings & health</h2>
          {providerHealth && <><div className="admin-health-summary"><span>{readyProviders} / {providerCount} ready</span><span>Configuration status</span></div><div className="provider-grid">{Object.entries(providerHealth.providers).map(([name, status]) => <article className="admin-list-item" key={name}><strong>{name.replace(/([A-Z])/g, " $1")}</strong><small className={`health-label ${status}`}>{status.replaceAll("_", " ")}</small></article>)}</div><div className="stat-grid">{Object.entries(providerHealth.operations).map(([name, value]) => <div className="stat-card" key={name}><span className="stat-label">{name.replaceAll(/([A-Z])/g, " $1")}</span><strong>{value}</strong></div>)}</div><h3>Recent provider checks</h3>{Object.entries(providerHealth.history).map(([provider, checks]) => <div className="admin-list-item" key={provider}><strong>{provider}</strong>{checks.map((check, index) => <small key={`${check.checkedAt}-${index}`}>{check.status.replaceAll("_", " ")} · {check.details} · <time dateTime={check.checkedAt}>{new Date(check.checkedAt).toLocaleString()}</time></small>)}</div>)}<p className="muted small-copy">Provider readiness reflects configuration and database connectivity, not a live delivery test.</p></>}
        </section>}
      </>}
    </section>
  </main>;
}
