import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";

type OrganizationRole = "OWNER" | "ADMIN" | "EVENT_MANAGER" | "FINANCE" | "AUDITOR" | "PLATFORM_ADMIN";

interface Organization {
  id: string;
  name: string;
  slug: string;
  role: OrganizationRole;
  _count: { memberships: number; events: number };
}

interface Member {
  userId: string;
  role: Exclude<OrganizationRole, "PLATFORM_ADMIN">;
  createdAt: string;
  user: { name: string; email: string; emailVerifiedAt: string | null };
}

interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  createdAt: string;
  actor: { id: string; name: string } | null;
}

interface BillingPlan {
  id: string;
  name: string;
  description: string | null;
  price: string | number;
  currency: string;
  interval: string;
  features: string[];
  maxEvents: number | null;
  maxMembers: number | null;
}

interface BillingInvoice {
  id: string;
  plan: { name: string };
  provider: "PAYSTACK" | "MOOLRE";
  amount: string | number;
  currency: string;
  status: string;
  createdAt: string;
  paidAt: string | null;
}

interface BillingDetails {
  subscription: {
    status: string;
    currentPeriodEnd: string;
    plan: { name: string; price: string | number; currency: string; interval: string };
  } | null;
  invoices: BillingInvoice[];
}

const roleLabels: Record<Exclude<OrganizationRole, "PLATFORM_ADMIN">, string> = {
  OWNER: "Owner",
  ADMIN: "Administrator",
  EVENT_MANAGER: "Event manager",
  FINANCE: "Finance",
  AUDITOR: "Read-only auditor",
};

export function OrganizationSettings({ userRole }: { userRole: string }) {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [billingPlans, setBillingPlans] = useState<BillingPlan[]>([]);
  const [billingProviders, setBillingProviders] = useState<Record<"PAYSTACK" | "MOOLRE", boolean>>({
    PAYSTACK: false,
    MOOLRE: false,
  });
  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(null);
  const [billingPlanId, setBillingPlanId] = useState("");
  const [billingProvider, setBillingProvider] = useState<"PAYSTACK" | "MOOLRE">("PAYSTACK");
  const [name, setName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<Exclude<OrganizationRole, "PLATFORM_ADMIN">>("EVENT_MANAGER");
  const [auditSearch, setAuditSearch] = useState("");
  const [error, setError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [auditError, setAuditError] = useState("");
  const [billingError, setBillingError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const selected = organizations.find((organization) => organization.id === selectedId);
  const selectedBillingPlan = billingPlans.find((plan) => plan.id === billingPlanId);
  const canManage = Boolean(selected && ["OWNER", "ADMIN", "PLATFORM_ADMIN"].includes(selected.role));
  const canManageBilling = Boolean(selected && ["OWNER", "ADMIN", "FINANCE", "PLATFORM_ADMIN"].includes(selected.role));
  const canViewAudit = Boolean(selected && ["OWNER", "ADMIN", "AUDITOR", "PLATFORM_ADMIN"].includes(selected.role));
  const assignableRoles = useMemo(
    () => selected?.role === "OWNER" || selected?.role === "PLATFORM_ADMIN"
      ? Object.keys(roleLabels) as Exclude<OrganizationRole, "PLATFORM_ADMIN">[]
      : (Object.keys(roleLabels).filter((role) => role !== "OWNER") as Exclude<OrganizationRole, "PLATFORM_ADMIN">[]),
    [selected?.role],
  );

  async function loadOrganizations() {
    try {
      const result = await api<{ organizations: Organization[] }>("/api/organizations");
      setOrganizations(result.organizations);
      setSelectedId((current) =>
        result.organizations.some((organization) => organization.id === current)
          ? current
          : result.organizations[0]?.id ?? "",
      );
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load organizations");
    }
  }

  async function loadOrganizationDetails(organizationId: string) {
    if (!organizationId) {
      setMembers([]);
      setMembersError("");
      return;
    }
    const organization = organizations.find((item) => item.id === organizationId);
    const canManageMembers = Boolean(
      organization && ["OWNER", "ADMIN", "PLATFORM_ADMIN"].includes(organization.role),
    );
    if (!canManageMembers) {
      setMembers([]);
      setMembersError("");
      return;
    }
    try {
      const result = await api<{ members: Member[] }>(`/api/organizations/${organizationId}/members`);
      setMembers(result.members);
      setMembersError("");
    } catch (reason) {
      setMembers([]);
      setMembersError(reason instanceof Error ? reason.message : "Could not load organization members");
    }
  }

  async function loadAuditHistory(organizationId: string, search: string) {
    if (!organizationId) {
      setAudit([]);
      setAuditError("");
      return;
    }
    const organization = organizations.find((item) => item.id === organizationId);
    const canViewAudit = Boolean(
      organization && ["OWNER", "ADMIN", "AUDITOR", "PLATFORM_ADMIN"].includes(organization.role),
    );
    if (!canViewAudit) {
      setAudit([]);
      setAuditError("");
      return;
    }
    try {
      const query = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      const result = await api<{ logs: AuditEntry[] }>(`/api/organizations/${organizationId}/audit${query}`);
      setAudit(result.logs);
      setAuditError("");
    } catch (reason) {
      setAudit([]);
      setAuditError(reason instanceof Error ? reason.message : "Could not load organization audit history");
    }
  }

  async function loadBilling(organizationId: string) {
    if (!organizationId || !canManageBilling) {
      setBillingDetails(null);
      setBillingError("");
      return;
    }
    try {
      const [plansResult, detailsResult] = await Promise.all([
        api<{ plans: BillingPlan[]; providers: Record<"PAYSTACK" | "MOOLRE", boolean> }>("/api/subscriptions/plans"),
        api<BillingDetails>(`/api/subscriptions/organizations/${organizationId}`),
      ]);
      setBillingPlans(plansResult.plans);
      setBillingProviders(plansResult.providers);
      setBillingPlanId((current) =>
        plansResult.plans.some((plan) => plan.id === current)
          ? current
          : plansResult.plans[0]?.id ?? "",
      );
      setBillingProvider(plansResult.providers.PAYSTACK ? "PAYSTACK" : "MOOLRE");
      setBillingDetails(detailsResult);
      setBillingError("");
    } catch (reason) {
      setBillingError(reason instanceof Error ? reason.message : "Could not load billing details");
    }
  }

  useEffect(() => { void loadOrganizations(); }, []);
  useEffect(() => { void loadOrganizationDetails(selectedId); }, [selectedId]);
  useEffect(() => { void loadAuditHistory(selectedId, auditSearch); }, [selectedId, auditSearch]);
  useEffect(() => { void loadBilling(selectedId); }, [selectedId, canManageBilling]);

  async function createOrganization(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api<{ organization: Organization }>("/api/organizations", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setName("");
      setOrganizations((current) => [...current, { ...result.organization, role: "OWNER", _count: { events: 0, memberships: 1 } }]);
      setSelectedId(result.organization.id);
      setMessage("Organization created.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create organization");
    } finally {
      setBusy(false);
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(`/api/organizations/${selected.id}/members`, {
        method: "POST",
        body: JSON.stringify({ email: memberEmail, role: memberRole }),
      });
      setMemberEmail("");
      await Promise.all([
        loadOrganizationDetails(selected.id),
        loadAuditHistory(selected.id, auditSearch),
      ]);
      setMessage("Organization access updated.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update organization access");
    } finally {
      setBusy(false);
    }
  }

  async function removeMember(member: Member) {
    if (!selected || !window.confirm(`Remove ${member.user.name} from ${selected.name}?`)) return;
    setError("");
    setMessage("");
    try {
      await api(`/api/organizations/${selected.id}/members/${member.userId}`, { method: "DELETE" });
      await Promise.all([
        loadOrganizationDetails(selected.id),
        loadAuditHistory(selected.id, auditSearch),
      ]);
      setMessage("Organization access removed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove organization access");
    }
  }

  async function startCheckout(event: FormEvent) {
    event.preventDefault();
    if (!selected || !billingPlanId) return;
    setBusy(true);
    setBillingError("");
    try {
      const result = await api<{ checkoutUrl: string }>(`/api/subscriptions/organizations/${selected.id}/checkout`, {
        method: "POST",
        body: JSON.stringify({ planId: billingPlanId, provider: billingProvider }),
      });
      window.location.assign(result.checkoutUrl);
    } catch (reason) {
      setBillingError(reason instanceof Error ? reason.message : "Could not start subscription checkout");
      setBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
        <div className="side-label">ACCOUNT</div>
        <Link className="side-link" to="/dashboard"><span>←</span> Product home</Link>
        {userRole === "ADMIN" && <Link className="side-link" to="/admin"><span>AD</span> Central admin</Link>}
      </aside>
      <section className="main-content">
        <header className="topbar"><span className="breadcrumb">EventFlow <span>/</span> Organizations</span></header>
        <div className="page-heading">
          <div><div className="eyebrow">TEAM AND ACCESS</div><h1>Organizations</h1><p>Keep event ownership and team permissions within a workspace.</p></div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {message && <div className="alert alert-success" role="status">{message}</div>}
        <div className="organization-settings-grid">
          <section className="content-card">
            <div className="eyebrow">WORKSPACES</div>
            <h2>Your organizations</h2>
            {organizations.length > 0 && (
              <label className="organization-select-label">Selected organization
                <select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                  {organizations.map((organization) => <option key={organization.id} value={organization.id}>{organization.name} · {roleLabels[organization.role as keyof typeof roleLabels] ?? "Platform administrator"}</option>)}
                </select>
              </label>
            )}
            {selected && <p className="muted small-copy">{selected._count.events} events · {selected._count.memberships} members · /{selected.slug}</p>}
            {!organizations.length && <div className="empty-note">No organization access yet.</div>}
            {userRole !== "CHECK_IN_STAFF" && (
              <form className="stack-form organization-create-form" onSubmit={(event) => void createOrganization(event)}>
                <label>New organization<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Organization name" /></label>
                <button className="button button-dark" disabled={busy}>Create organization</button>
              </form>
            )}
          </section>

          <section className="content-card">
            <div className="eyebrow">ACCESS MANAGEMENT</div>
            <h2>Organization members</h2>
            {canManage && selected && (
              <form className="organization-member-form" onSubmit={(event) => void addMember(event)}>
                <label>Email address<input type="email" required value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="teammate@example.com" /></label>
                <label>Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}>{assignableRoles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select></label>
                <button className="button button-dark" disabled={busy}>Add or update member</button>
                <small className="muted">The account must be registered before it can be added.</small>
              </form>
            )}
            {membersError
              ? <div className="alert alert-error" role="alert">{membersError}</div>
              : members.length ? <div className="admin-directory-list">{members.map((member) => (
              <article className="admin-list-item admin-user-row" key={member.userId}>
                <span className="avatar">{member.user.name.slice(0, 1).toUpperCase()}</span>
                <span><strong>{member.user.name}</strong><small>{member.user.email}</small></span>
                <span className="status-pill">{roleLabels[member.role]}</span>
                {canManage && <button className="text-button" onClick={() => void removeMember(member)}>Remove</button>}
              </article>
            ))}</div> : <div className="empty-note">{selected
                ? canManage
                  ? "No organization members yet."
                  : "Member details are available to organization owners and administrators."
                : "Create or select an organization to manage members."}</div>}
          </section>

          {selected && canManageBilling && <section className="content-card">
            <div className="eyebrow">SUBSCRIPTION</div>
            <h2>Organization billing</h2>
            {billingError && <div className="alert alert-error" role="alert">{billingError}</div>}
            {billingDetails?.subscription
              ? <div className="admin-list-item">
                <strong>{billingDetails.subscription.plan.name} · {billingDetails.subscription.status}</strong>
                <small>
                  {billingDetails.subscription.plan.currency} {Number(billingDetails.subscription.plan.price).toFixed(2)} / {billingDetails.subscription.plan.interval.toLowerCase()}
                  {" · "}Renews {new Date(billingDetails.subscription.currentPeriodEnd).toLocaleDateString()}
                </small>
              </div>
              : <div className="empty-note">No active subscription.</div>}
            {billingPlans.length > 0 && (billingProviders.PAYSTACK || billingProviders.MOOLRE)
              ? <form className="stack-form" onSubmit={(event) => void startCheckout(event)}>
                <label>Plan<select value={billingPlanId} onChange={(event) => setBillingPlanId(event.target.value)}>
                  {billingPlans.map((plan) => <option key={plan.id} value={plan.id}>
                    {plan.name} · {plan.currency} {Number(plan.price).toFixed(2)} / {plan.interval.toLowerCase()}
                  </option>)}
                </select></label>
                {selectedBillingPlan && <>
                  <small className="muted">
                    Limits: {selectedBillingPlan.maxEvents ?? "Unlimited"} events · {selectedBillingPlan.maxMembers ?? "Unlimited"} members
                  </small>
                  {selectedBillingPlan.features.length > 0 && <small className="muted">{selectedBillingPlan.features.join(" · ")}</small>}
                </>}
                <label>Payment provider<select
                  value={billingProvider}
                  onChange={(event) => setBillingProvider(event.target.value as typeof billingProvider)}
                >
                  {billingProviders.PAYSTACK && <option value="PAYSTACK">Paystack</option>}
                  {billingProviders.MOOLRE && <option value="MOOLRE">Moolre</option>}
                </select></label>
                <button className="button button-dark" disabled={busy || !billingPlanId}>Continue to payment</button>
              </form>
              : <div className="empty-note">
                {!billingPlans.length ? "Subscription plans have not been configured." : "No subscription payment provider is configured."}
              </div>}
            {billingDetails?.invoices.length ? <div className="admin-directory-list">
              <h3>Recent invoices</h3>
              {billingDetails.invoices.map((invoice) => <article className="admin-list-item" key={invoice.id}>
                <strong>{invoice.plan.name} · {invoice.status}</strong>
                <small>{invoice.currency} {Number(invoice.amount).toFixed(2)} · {invoice.provider} · {new Date(invoice.createdAt).toLocaleDateString()}</small>
              </article>)}
            </div> : null}
          </section>}

          {selected && canViewAudit && <section className="content-card organization-audit-card">
            <div className="eyebrow">ACCOUNTABILITY</div>
            <h2>Recent organization activity</h2>
            <label>Search activity<input
              type="search"
              aria-label="Search audit history"
              value={auditSearch}
              onChange={(event) => setAuditSearch(event.target.value)}
              placeholder="Action, record, or actor"
            /></label>
            {auditError
              ? <div className="alert alert-error" role="alert">{auditError}</div>
              : audit.length ? audit.map((entry) => <article className="admin-list-item" key={entry.id}>
              <strong>{entry.action.replaceAll("_", " ")}</strong>
              <small>{entry.entityType} · {entry.actor?.name ?? "System"} · {new Date(entry.createdAt).toLocaleString()}</small>
            </article>) : <div className="empty-note">Organization changes will appear here.</div>}
          </section>}
        </div>
      </section>
    </main>
  );
}
