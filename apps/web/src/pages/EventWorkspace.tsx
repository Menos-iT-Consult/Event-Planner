import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { User } from "../App";
import { api, formatDate, formatMoney } from "../api";
import { CubeLoader } from "../components/CubeLoader";
import { getEventProduct } from "../products";
import { GeneralEventWorkspace } from "./GeneralEventWorkspace";
import { VotingEventWorkspace } from "./VotingEventWorkspace";
import { WeddingEventWorkspace } from "./WeddingEventWorkspace";
import { WeddingChecklistPanel, WeddingSeatingPanel, WeddingWebsitePanel } from "./WeddingTools";
import type { AnalyticsData, Category, EventData, Guest, WorkspaceData } from "./workspace-types";

const emptyData: WorkspaceData = {
  guests: [], categories: [], budget: [], vendors: [], registry: [], sessions: [], tiers: [],
};

const tabsByEventType = {
  WEDDING: [
    ["overview", "Overview"],
    ["guests", "Guests"],
    ["programme", "Programme"],
    ["checklist", "Checklist"],
    ["seating", "Seating"],
    ["wedding", "Wedding details"],
    ["website", "Website & invites"],
    ["updates", "Updates"],
    ["team", "Event team"],
    ["operations", "Operations"],
  ],
  VOTING: [
    ["overview", "Overview"],
    ["engage", "Contest & voting"],
    ["updates", "Updates"],
    ["team", "Event team"],
    ["operations", "Operations"],
  ],
  GENERAL: [
    ["overview", "Overview"],
    ["guests", "Guests"],
    ["programme", "Programme"],
    ["tickets", "Tickets"],
    ["updates", "Updates"],
    ["team", "Event team"],
    ["operations", "Operations"],
  ],
} as const;

export function EventWorkspace({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventData | null>(null);
  const [data, setData] = useState(emptyData);
  const [tab, setTab] = useState<string>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);

  async function load() {
    try {
      const { event: current } = await api<{ event: EventData }>(`/api/events/${eventId}`);
      setEvent(current);
      const nextData = { ...emptyData };
      if (current.type === "WEDDING") {
        const [guests, budget, vendors, registry, sessions] = await Promise.all([
          api<{ guests: Guest[] }>(`/api/events/${eventId}/guests`),
          api<{ items: WorkspaceData["budget"] }>(`/api/events/${eventId}/budget`),
          api<{ vendors: WorkspaceData["vendors"] }>(`/api/events/${eventId}/vendors`),
          api<{ items: WorkspaceData["registry"] }>(`/api/events/${eventId}/registry`),
          api<{ sessions: WorkspaceData["sessions"] }>(`/api/events/${eventId}/sessions`),
        ]);
        Object.assign(nextData, { guests: guests.guests, budget: budget.items, vendors: vendors.vendors, registry: registry.items, sessions: sessions.sessions });
      } else if (current.type === "VOTING") {
        const { categories } = await api<{ categories: Category[] }>(`/api/events/${eventId}/categories`);
        nextData.categories = categories;
      } else {
        const [guests, sessions, tiers] = await Promise.all([
          api<{ guests: Guest[] }>(`/api/events/${eventId}/guests`),
          api<{ sessions: WorkspaceData["sessions"] }>(`/api/events/${eventId}/sessions`),
          api<{ tiers: WorkspaceData["tiers"] }>(`/api/events/${eventId}/ticket-tiers`),
        ]);
        Object.assign(nextData, { guests: guests.guests, sessions: sessions.sessions, tiers: tiers.tiers });
      }
      const eventAnalytics = await api<AnalyticsData>(`/api/events/${eventId}/analytics`);
      setData(nextData);
      setAnalytics(eventAnalytics);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this event");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setTab("overview");
    setLoading(true);
    void load();
  }, [eventId]);

  async function togglePublication() {
    if (!event) return;
    try {
      await api(`/api/events/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify({ isPublished: !event.isPublished }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update publication");
    }
  }

  async function deleteEvent() {
    if (!event || !window.confirm(`Delete "${event.title}"? This cannot be undone.`)) return;
    try {
      await api(`/api/events/${eventId}`, { method: "DELETE" });
      window.location.assign("/dashboard");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not delete event");
    }
  }

  const visibleTabs = event ? tabsByEventType[event.type] : tabsByEventType.WEDDING;
  const product = event ? getEventProduct(event.type) : null;

  if (loading) return <main className="loading-screen"><CubeLoader label="Details" /></main>;
  if (!event) return <main className="center-card"><div className="alert alert-error">{error || "Event not found"}</div><Link to="/dashboard" className="button button-outline">Return to workspace</Link></main>;

  const activePanel = (() => {
    if (tab === "guests" && (event.type === "WEDDING" || event.type === "GENERAL")) return <GuestsPanel eventId={event.id} data={data} onRefresh={load} isWedding={event.type === "WEDDING"} />;
    if (tab === "programme" && event.type !== "VOTING") return <ProgrammePanel eventId={event.id} data={data} onRefresh={load} isWedding={event.type === "WEDDING"} />;
    if (tab === "checklist" && event.type === "WEDDING") return <WeddingChecklistPanel eventId={event.id} />;
    if (tab === "seating" && event.type === "WEDDING") return <WeddingSeatingPanel eventId={event.id} />;
    if (tab === "website" && event.type === "WEDDING") return <WeddingWebsitePanel eventId={event.id} slug={event.slug} startDate={event.startDate} endDate={event.endDate} />;
    if (tab === "tickets" && event.type === "GENERAL") return <TicketsPanel eventId={event.id} event={event} data={data} onRefresh={load} />;
    if (tab === "engage" && event.type === "VOTING") return <VotingPanel eventId={event.id} data={data} onRefresh={load} />;
    if (tab === "wedding" && event.type === "WEDDING") return <WeddingPanel eventId={event.id} data={data} onRefresh={load} />;
    if (tab === "updates") return <BroadcastPanel eventId={event.id} />;
    if (tab === "team") return <BroadcastPanel eventId={event.id} team />;
    if (tab === "operations") return <OperationsPanel eventId={event.id} />;
    return null;
  })();

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
        <div className="side-label">EVENT SPACE</div>
        <Link className="side-link" to={product?.path ?? "/dashboard"}><span>←</span> {product?.name ?? "All products"}</Link>
        <Link className="side-link" to="/dashboard"><span>↗</span> Switch product</Link>
        <div className="event-sidebar-card"><span className={`event-dot ${event.type.toLowerCase()}`} /><div><strong>{event.title}</strong><small>{event.type.replace("_", " ").toLowerCase()}</small></div></div>
        <div className="side-label side-spaced">MANAGE</div>
        {visibleTabs.map(([key, label]) => <button key={key} className={`side-link side-button ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}><span>{iconForTab(key)}</span>{label}</button>)}
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ").toLowerCase()}</small></span></div>
          <Link className="text-button" to={`/e/${event.slug}`} target="_blank" rel="noreferrer">View public page</Link>
        </div>
      </aside>
      <section className="main-content">
        <header className="topbar"><span className="breadcrumb"><Link to={product?.path ?? "/dashboard"}>{product?.name ?? "Workspace"}</Link> <span>/</span> {event.title}</span>{event.type === "GENERAL" && <Link className="topbar-link" to={`/scanner/${event.id}`}>Open gate scanner</Link>}</header>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="event-workspace-heading">
          <div className={`event-cover-mark ${event.type.toLowerCase()}`}>{event.type}</div>
          <div className="event-heading-copy"><div className="eyebrow">{event.type.replace("_", " ")} · YOUR EVENT</div><h1>{event.title}</h1><p>{event.location} <span className="heading-divider">·</span> {formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</p></div>
          <div className="heading-actions">
            <a className="button button-outline" href={`/e/${event.slug}`} target="_blank" rel="noreferrer">Public page</a>
            <button className="button button-outline" onClick={() => void togglePublication()}>{event.isPublished ? "Unpublish" : "Publish"}</button>
            {event.type !== "VOTING" && <a className="button button-outline" href={`/api/events/${event.id}/export/guests`} download>Export guests</a>}
            <button className="button button-outline" onClick={() => void deleteEvent()}>Delete</button>
          </div>
        </div>
        <nav className="workspace-tabs" aria-label="Event sections">{visibleTabs.map(([key, label]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
        {event.type === "WEDDING" && <WeddingEventWorkspace event={event} data={data} analytics={analytics} tab={tab} onSelect={setTab}>{activePanel}</WeddingEventWorkspace>}
        {event.type === "VOTING" && <VotingEventWorkspace event={event} data={data} analytics={analytics} tab={tab} onSelect={setTab}>{activePanel}</VotingEventWorkspace>}
        {event.type === "GENERAL" && <GeneralEventWorkspace event={event} data={data} analytics={analytics} tab={tab} onSelect={setTab}>{activePanel}</GeneralEventWorkspace>}
      </section>
    </main>
  );
}

function OperationsPanel({ eventId }: { eventId: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [waitlist, setWaitlist] = useState<Array<{ id:string;name:string;email:string;phone?:string|null;notified:boolean }>>([]);
  const [promos, setPromos] = useState<Array<{ id:string;code:string;percentOff?:string|null;amountOff?:string|null;redemptions:number;enabled:boolean }>>([]);
  const [seats, setSeats] = useState<Array<{ id:string;section:string;row:string;number:string;reservedBy?:string|null }>>([]);
  const [surveys, setSurveys] = useState<Array<{ id:string;title:string;isPublished:boolean;_count?:{responses:number} }>>([]);
  const [certificates, setCertificates] = useState<Array<{ id:string;recipientName:string;title:string;issuedAt:string }>>([]);
  const [schedules, setSchedules] = useState<Array<{ id:string;frequency:string;interval:number;timezone:string }>>([]);
  const [invoices, setInvoices] = useState<Array<{ id:string;number:string;customerName:string;total:string;currency:string;status:string }>>([]);
  const [promo, setPromo] = useState({ code: "", percentOff: "", amountOff: "", maxRedemptions: "" });
  const [seat, setSeat] = useState({ section: "", row: "", number: "", reservedBy: "" });
  const [survey, setSurvey] = useState({ title: "", description: "" });
  const [certificate, setCertificate] = useState({ recipientName: "", recipientEmail: "", title: "" });
  const [schedule, setSchedule] = useState({ frequency: "WEEKLY", interval: "1", timezone: "Africa/Accra" });
  const [invoice, setInvoice] = useState({ customerName: "", customerEmail: "", description: "", unitPrice: "", quantity: "1", taxRate: "0" });

  async function load() {
    try {
      const [waitlistResult, promoResult, seatResult, surveyResult, certificateResult, scheduleResult, invoiceResult] = await Promise.all([
        api<{entries:typeof waitlist}>(`/api/events/${eventId}/waitlist`),
        api<{promos:typeof promos}>(`/api/events/${eventId}/promos`),
        api<{seats:typeof seats}>(`/api/events/${eventId}/seats`),
        api<{surveys:typeof surveys}>(`/api/events/${eventId}/surveys`),
        api<{certificates:typeof certificates}>(`/api/events/${eventId}/certificates`),
        api<{schedules:typeof schedules}>(`/api/events/${eventId}/recurring`),
        api<{invoices:typeof invoices}>(`/api/events/${eventId}/invoices`),
      ]);
      setWaitlist(waitlistResult.entries); setPromos(promoResult.promos); setSeats(seatResult.seats);
      setSurveys(surveyResult.surveys); setCertificates(certificateResult.certificates);
      setSchedules(scheduleResult.schedules); setInvoices(invoiceResult.invoices); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load operations data"); }
  }
  useEffect(() => { void load(); }, [eventId]);

  async function submit(path: string, body: Record<string, unknown>, success: string, reset?: () => void) {
    setError(""); setMessage("");
    try { await api(`/api/events/${eventId}/${path}`, { method: "POST", body: JSON.stringify(body) }); setMessage(success); reset?.(); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save operation"); }
  }

  return <div className="workspace-body">
    <div className="section-heading"><div><div className="eyebrow">EVENT OPERATIONS</div><h2>Promotions, seating, surveys & records</h2></div></div>
    {error && <div className="alert alert-error">{error}</div>}{message && <div className="alert alert-success">{message}</div>}
    <div className="two-column-panels">
      <section className="content-card"><div className="eyebrow">PROMOTION</div><h3>Create a promo code</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); void submit("promos", { code: promo.code, percentOff: promo.percentOff ? Number(promo.percentOff) : undefined, amountOff: promo.amountOff ? Number(promo.amountOff) : undefined, maxRedemptions: promo.maxRedemptions ? Number(promo.maxRedemptions) : undefined }, "Promo code created.", () => setPromo({ code: "", percentOff: "", amountOff: "", maxRedemptions: "" })); }}><label>Code<input required value={promo.code} onChange={(event) => setPromo({ ...promo, code: event.target.value })} /></label><div className="form-row"><label>Percent off<input type="number" min="0.01" max="100" step="0.01" value={promo.percentOff} onChange={(event) => setPromo({ ...promo, percentOff: event.target.value })} /></label><label>Fixed amount off<input type="number" min="0.01" step="0.01" value={promo.amountOff} onChange={(event) => setPromo({ ...promo, amountOff: event.target.value })} /></label></div><label>Maximum redemptions<input type="number" min="1" value={promo.maxRedemptions} onChange={(event) => setPromo({ ...promo, maxRedemptions: event.target.value })} /></label><button className="button button-dark">Create promo</button></form></section>
      <section className="content-card"><div className="eyebrow">PROMO LIST</div><h3>Active promotions</h3>{promos.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.code}</strong><small>{item.percentOff ? `${item.percentOff}% off` : `${item.amountOff} amount off`} · {item.redemptions} used</small></article>)}{!promos.length && <div className="empty-note">No promotion codes.</div>}</section>
      <section className="content-card"><div className="eyebrow">SEATING</div><h3>Add a seat</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); void submit("seats", { ...seat, reservedBy: seat.reservedBy || undefined }, "Seat added.", () => setSeat({ section: "", row: "", number: "", reservedBy: "" })); }}><div className="form-row"><label>Section<input required value={seat.section} onChange={(event) => setSeat({ ...seat, section: event.target.value })} /></label><label>Row<input required value={seat.row} onChange={(event) => setSeat({ ...seat, row: event.target.value })} /></label></div><div className="form-row"><label>Number<input required value={seat.number} onChange={(event) => setSeat({ ...seat, number: event.target.value })} /></label><label>Reserved by<input value={seat.reservedBy} onChange={(event) => setSeat({ ...seat, reservedBy: event.target.value })} /></label></div><button className="button button-outline">Add seat</button></form></section>
      <section className="content-card"><div className="eyebrow">SEAT MAP</div><h3>Reserved seats</h3>{seats.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.section} {item.row}-{item.number}</strong><small>{item.reservedBy ?? "Available"}</small></article>)}{!seats.length && <div className="empty-note">No seats configured.</div>}</section>
      <section className="content-card"><div className="eyebrow">SURVEY</div><h3>Create a survey</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); void submit("surveys", { title: survey.title, description: survey.description || undefined, questions: [{ type: "text", label: "Additional feedback" }], isPublished: true }, "Survey created.", () => setSurvey({ title: "", description: "" })); }}><label>Title<input required value={survey.title} onChange={(event) => setSurvey({ ...survey, title: event.target.value })} /></label><label>Description<input value={survey.description} onChange={(event) => setSurvey({ ...survey, description: event.target.value })} /></label><button className="button button-outline">Create survey</button></form></section>
      <section className="content-card"><div className="eyebrow">SURVEY RESULTS</div><h3>Published surveys</h3>{surveys.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.title}</strong><small>{item._count?.responses ?? 0} responses · {item.isPublished ? "Published" : "Draft"}</small></article>)}{!surveys.length && <div className="empty-note">No surveys created.</div>}</section>
      <section className="content-card"><div className="eyebrow">CERTIFICATE</div><h3>Issue a certificate</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); void submit("certificates", certificate, "Certificate issued.", () => setCertificate({ recipientName: "", recipientEmail: "", title: "" })); }}><label>Recipient name<input required value={certificate.recipientName} onChange={(event) => setCertificate({ ...certificate, recipientName: event.target.value })} /></label><label>Recipient email<input type="email" required value={certificate.recipientEmail} onChange={(event) => setCertificate({ ...certificate, recipientEmail: event.target.value })} /></label><label>Certificate title<input required value={certificate.title} onChange={(event) => setCertificate({ ...certificate, title: event.target.value })} /></label><button className="button button-outline">Issue certificate</button></form></section>
      <section className="content-card"><div className="eyebrow">CERTIFICATE HISTORY</div><h3>Issued certificates</h3>{certificates.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.title}</strong><small>{item.recipientName} · {formatDate(item.issuedAt)}</small></article>)}{!certificates.length && <div className="empty-note">No certificates issued.</div>}</section>
      <section className="content-card"><div className="eyebrow">RECURRING SCHEDULE</div><h3>Add a schedule</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); void submit("recurring", { frequency: schedule.frequency, interval: Number(schedule.interval), timezone: schedule.timezone }, "Recurring schedule created."); }}><div className="form-row"><label>Frequency<select value={schedule.frequency} onChange={(event) => setSchedule({ ...schedule, frequency: event.target.value })}><option>DAILY</option><option>WEEKLY</option><option>MONTHLY</option></select></label><label>Interval<input type="number" min="1" max="365" required value={schedule.interval} onChange={(event) => setSchedule({ ...schedule, interval: event.target.value })} /></label></div><label>Timezone<input required value={schedule.timezone} onChange={(event) => setSchedule({ ...schedule, timezone: event.target.value })} /></label><button className="button button-outline">Create schedule</button></form></section>
      <section className="content-card"><div className="eyebrow">WAITLIST</div><h3>Waiting guests</h3>{waitlist.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.name}</strong><small>{item.email} · {item.notified ? "Notified" : "Pending"}</small>{!item.notified && <button className="text-button" onClick={() => void api(`/api/events/${eventId}/waitlist/${item.id}/notified`, { method: "PATCH" }).then(load)}>Mark notified</button>}</article>)}{!waitlist.length && <div className="empty-note">No waiting guests.</div>}</section>
      <section className="content-card"><div className="eyebrow">INVOICE</div><h3>Create an invoice</h3><form className="stack-form compact-form" onSubmit={(event) => { event.preventDefault(); const subtotal = Number(invoice.unitPrice) * Number(invoice.quantity); void submit("invoices", { customerName: invoice.customerName, customerEmail: invoice.customerEmail, subtotal, taxRate: Number(invoice.taxRate), currency: "GHS", lines: [{ description: invoice.description, quantity: Number(invoice.quantity), unitPrice: Number(invoice.unitPrice) }] }, "Invoice created.", () => setInvoice({ customerName: "", customerEmail: "", description: "", unitPrice: "", quantity: "1", taxRate: "0" })); }}><label>Customer name<input required value={invoice.customerName} onChange={(event) => setInvoice({ ...invoice, customerName: event.target.value })} /></label><label>Customer email<input type="email" required value={invoice.customerEmail} onChange={(event) => setInvoice({ ...invoice, customerEmail: event.target.value })} /></label><label>Line item<input required value={invoice.description} onChange={(event) => setInvoice({ ...invoice, description: event.target.value })} /></label><div className="form-row"><label>Unit price<input type="number" min="0.01" step="0.01" required value={invoice.unitPrice} onChange={(event) => setInvoice({ ...invoice, unitPrice: event.target.value })} /></label><label>Quantity<input type="number" min="1" required value={invoice.quantity} onChange={(event) => setInvoice({ ...invoice, quantity: event.target.value })} /></label></div><label>Tax rate percent<input type="number" min="0" max="100" step="0.01" value={invoice.taxRate} onChange={(event) => setInvoice({ ...invoice, taxRate: event.target.value })} /></label><button className="button button-outline">Create invoice</button></form></section>
      <section className="content-card"><div className="eyebrow">INVOICES</div><h3>Issued invoices</h3>{invoices.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.number}</strong><small>{item.customerName} · {formatMoney(item.total, item.currency)} · {item.status}</small></article>)}{!invoices.length && <div className="empty-note">No invoices issued.</div>}</section>
      <section className="content-card"><div className="eyebrow">RECURRING LIST</div><h3>Schedules</h3>{schedules.map((item) => <article className="admin-list-item" key={item.id}><strong>{item.frequency}</strong><small>Every {item.interval} · {item.timezone}</small></article>)}{!schedules.length && <div className="empty-note">No recurring schedules.</div>}</section>
    </div>
  </div>;
}

function iconForTab(tab: string): string {
  return ({ overview: "01", guests: "02", programme: "03", tickets: "04", engage: "05", wedding: "06", updates: "07", team: "08", operations: "09" } as Record<string, string>)[tab] ?? "00";
}

function GuestsPanel({ eventId, data, onRefresh, isWedding = false }: { eventId: string; data: WorkspaceData; onRefresh: () => void; isWedding?: boolean }) {
  type Household = { id: string; name: string; guests: Array<{ id: string; name: string }> };
  const [form, setForm] = useState({ name: "", phone: "", email: "", plusOnes: 0, dietary: "", householdId: "" });
  const [households, setHouseholds] = useState<Household[]>([]);
  const [householdName, setHouseholdName] = useState("");
  const [filter, setFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedGuestIds, setSelectedGuestIds] = useState<string[]>([]);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadHouseholds() {
    if (!isWedding) return;
    try {
      const { households: current } = await api<{ households: Household[] }>(`/api/events/${eventId}/wedding/households`);
      setHouseholds(current);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load guest households");
    }
  }

  useEffect(() => { void loadHouseholds(); }, [eventId, isWedding]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setResult("");
    try {
      const response = await api<{ rsvpUrl: string; smsStatus: string }>(`/api/events/${eventId}/guests`, { method: "POST", body: JSON.stringify({ ...form, householdId: form.householdId || undefined, email: form.email || undefined, plusOnes: Number(form.plusOnes), dietary: form.dietary || undefined }) });
      setResult(`Invite sent (${response.smsStatus.toLowerCase()}). RSVP link: ${response.rsvpUrl}`);
      setForm({ name: "", phone: "", email: "", plusOnes: 0, dietary: "", householdId: "" });
      onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add guest"); }
    finally { setBusy(false); }
  }

  async function createHousehold(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const { household } = await api<{ household: Household }>(`/api/events/${eventId}/wedding/households`, {
        method: "POST",
        body: JSON.stringify({ name: householdName }),
      });
      setHouseholdName("");
      await loadHouseholds();
      setForm((current) => ({ ...current, householdId: household.id }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create household");
    }
  }

  async function assignHousehold(guestId: string, householdId: string) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/guests/${guestId}`, {
        method: "PATCH",
        body: JSON.stringify({ householdId: householdId || null }),
      });
      onRefresh();
      await loadHouseholds();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update guest household");
    }
  }

  async function sendInvitations() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await api<{ invited: number; failed: number }>(`/api/events/${eventId}/wedding/invitations`, {
        method: "POST",
        body: JSON.stringify({ guestIds: selectedGuestIds.slice(0, 50) }),
      });
      setResult(`${response.invited} invitation${response.invited === 1 ? "" : "s"} sent; ${response.failed} failed.`);
      setSelectedGuestIds([]);
      onRefresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send invitations");
    } finally {
      setBusy(false);
    }
  }

  const visibleGuests = data.guests.filter((guest) =>
    (statusFilter === "ALL" || guest.status === statusFilter) &&
    `${guest.name} ${guest.email ?? ""} ${guest.phone} ${guest.household?.name ?? ""}`.toLowerCase().includes(filter.toLowerCase()),
  );
  const allVisibleSelected = visibleGuests.length > 0 && visibleGuests.every((guest) => selectedGuestIds.includes(guest.id));

  return <div className="workspace-body">
    <div className="section-heading"><div><div className="eyebrow">YOUR PEOPLE, ALL TOGETHER</div><h2>Guest list <span className="heading-count">{data.guests.length}</span></h2></div></div>
    {isWedding && <section className="content-card">
      <div className="section-heading compact"><div><div className="eyebrow">INVITATIONS & HOUSEHOLDS</div><h3>Organize your guest list</h3></div>
        <button className="button button-outline" disabled={!selectedGuestIds.length || selectedGuestIds.length > 50 || busy} onClick={() => void sendInvitations()}>Resend to selected ({selectedGuestIds.length})</button>
      </div>
      {selectedGuestIds.length > 50 && <div className="alert alert-error" role="alert">Select no more than 50 guests per invitation batch.</div>}
      <div className="form-row">
        <label>Search guests<input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Name, phone, email, household" /></label>
        <label>RSVP status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All responses</option><option value="PENDING">Pending</option><option value="ATTENDING">Attending</option><option value="DECLINED">Declined</option></select></label>
      </div>
      <form className="inline-form" onSubmit={(event) => void createHousehold(event)}>
        <input required maxLength={160} value={householdName} onChange={(event) => setHouseholdName(event.target.value)} placeholder="New household name" />
        <button className="button button-outline">Create household</button>
      </form>
      {households.length > 0 && <div className="admin-directory-list">{households.map((household) => <div className="admin-list-item" key={household.id}><strong>{household.name}</strong><small>{household.guests.length} guest{household.guests.length === 1 ? "" : "s"}</small></div>)}</div>}
    </section>}
    <div className="two-column-panels guest-layout">
      <section className="content-card"><div className="eyebrow">SEND AN INVITATION</div><h3>Add a guest</h3><p className="muted small-copy">They’ll receive a private RSVP link by SMS.</p><form className="stack-form compact-form" onSubmit={submit}>
        <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Guest name" /></label>
        <label>Phone<input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+233 24 000 0000" /></label>
        <label>Email <span className="muted">(optional)</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="guest@example.com" /></label>
        {isWedding && <label>Household<select value={form.householdId} onChange={(e) => setForm({ ...form, householdId: e.target.value })}><option value="">No household</option>{households.map((household) => <option value={household.id} key={household.id}>{household.name}</option>)}</select></label>}
        <div className="form-row"><label>Plus-one allowance<input type="number" min="0" max="20" value={form.plusOnes} onChange={(e) => setForm({ ...form, plusOnes: Number(e.target.value) })} /></label><label>Dietary note<input value={form.dietary} onChange={(e) => setForm({ ...form, dietary: e.target.value })} placeholder="Optional" /></label></div>
        {error && <div className="alert alert-error">{error}</div>}{result && <div className="alert alert-success">{result}</div>}
        <button className="button button-dark" disabled={busy}>{busy ? <CubeLoader label="Invite" compact /> : <>Add guest & invite <span>↗</span></>}</button>
      </form></section>
      <section className="content-card table-card"><div className="table-scroll"><table><thead><tr><th>{isWedding && <input aria-label="Select all visible guests" type="checkbox" checked={allVisibleSelected} onChange={(event) => setSelectedGuestIds(event.target.checked ? [...new Set([...selectedGuestIds, ...visibleGuests.map((guest) => guest.id)])] : selectedGuestIds.filter((id) => !visibleGuests.some((guest) => guest.id === id)))} />}</th><th>GUEST</th><th>HOUSEHOLD</th><th>RESPONSE</th><th>INVITATION</th><th>PLUS-ONES</th><th>DIETARY</th></tr></thead><tbody>
        {visibleGuests.map((guest) => <tr key={guest.id}><td>{isWedding && <input aria-label={`Select ${guest.name}`} type="checkbox" checked={selectedGuestIds.includes(guest.id)} onChange={(event) => setSelectedGuestIds(event.target.checked ? [...selectedGuestIds, guest.id] : selectedGuestIds.filter((id) => id !== guest.id))} />}</td><td><strong>{guest.name}</strong><small>{guest.phone}</small></td><td>{isWedding ? <select aria-label={`Household for ${guest.name}`} value={guest.householdId ?? ""} onChange={(event) => void assignHousehold(guest.id, event.target.value)}><option value="">No household</option>{households.map((household) => <option value={household.id} key={household.id}>{household.name}</option>)}</select> : guest.household?.name ?? "—"}</td><td><span className={`status-pill ${guest.status.toLowerCase()}`}>{guest.status.toLowerCase()}</span></td><td>{guest.invitationSentAt ? formatDate(guest.invitationSentAt) : <span className="muted">Not sent</span>}</td><td>{guest.plusOnes}{guest.plusOnesAllowed !== undefined ? ` / ${guest.plusOnesAllowed} allowed` : ""}</td><td>{guest.dietary || <span className="muted">—</span>}</td></tr>)}
        {!visibleGuests.length && <tr><td colSpan={7} className="table-empty">{data.guests.length ? "No guests match your filters." : "Your guest list is ready when you are."}</td></tr>}
      </tbody></table></div></section>
    </div>
  </div>;
}

function ProgrammePanel({ eventId, data, onRefresh, isWedding = false }: { eventId: string; data: WorkspaceData; onRefresh: () => void; isWedding?: boolean }) {
  const [form, setForm] = useState({ title: "", startsAt: "", endsAt: "", location: "", speaker: "", description: "", weddingDayId: "" });
  const [days, setDays] = useState<Array<{id:string;name:string;date:string;location?:string|null}>>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isWedding) return;
    api<{days:typeof days}>(`/api/events/${eventId}/wedding/days`)
      .then(({ days: current }) => setDays(current))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load wedding days"));
  }, [eventId, isWedding]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      await api(`/api/events/${eventId}/sessions`, { method: "POST", body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), description: form.description || undefined, location: form.location || undefined, speaker: form.speaker || undefined, weddingDayId: form.weddingDayId || undefined }) });
      setForm({ title: "", startsAt: "", endsAt: "", location: "", speaker: "", description: "", weddingDayId: "" }); onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add session"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">A THOUGHTFUL FLOW</div><h2>{isWedding ? "Wedding programme" : "Programme & sessions"}</h2></div></div>
    <div className="two-column-panels"><section className="content-card"><div className="eyebrow">MAKE A MOMENT OF IT</div><h3>Add a session</h3><form className="stack-form compact-form" onSubmit={submit}><label>Session title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>{isWedding && <label>Wedding day<select value={form.weddingDayId} onChange={(e) => setForm({ ...form, weddingDayId: e.target.value })}><option value="">Not assigned to a named day</option>{days.map((day) => <option value={day.id} key={day.id}>{day.name}</option>)}</select></label>}<div className="form-row"><label>Starts<input required type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label><label>Ends<input required type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label></div><label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label><label>Speaker<input value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-dark">Add to programme ↗</button></form></section>
      <section className="content-card"><div className="eyebrow">THE RUN OF SHOW</div><h3>{data.sessions.length} scheduled moments</h3><div className="session-list">{data.sessions.map((session) => <article className="session-item" key={session.id}><span className="session-time">{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(session.startsAt))}</span><div><strong>{session.title}</strong><small>{session.location || "Location to be announced"}{session.speaker ? ` · ${session.speaker}` : ""}{isWedding && session.weddingDayId ? ` · ${days.find((day) => day.id === session.weddingDayId)?.name ?? "Wedding day"}` : ""}</small></div><span className="session-date">{formatDate(session.startsAt)}</span></article>)}{!data.sessions.length && <div className="empty-note">Your programme is a blank canvas.</div>}</div></section></div>
  </div>;
}

function TicketsPanel({ eventId, event, data, onRefresh }: { eventId: string; event: EventData; data: WorkspaceData; onRefresh: () => void }) {
  const [form, setForm] = useState({ name: "", price: "", quantity: "", description: "" });
  const [error, setError] = useState("");
  async function submit(eventForm: FormEvent) {
    eventForm.preventDefault(); setError("");
    try {
      await api(`/api/events/${eventId}/ticket-tiers`, { method: "POST", body: JSON.stringify({ ...form, price: Number(form.price), quantity: Number(form.quantity), description: form.description || undefined }) });
      setForm({ name: "", price: "", quantity: "", description: "" }); onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add ticket tier"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">A WELCOME IN YOUR POCKET</div><h2>Tickets & digital passes</h2></div></div>
    <div className="two-column-panels"><section className="content-card"><div className="eyebrow">TICKET OPTIONS</div><h3>Create a ticket tier</h3><p className="muted small-copy">Paid via Paystack. Each confirmed order receives secure QR passes.</p><form className="stack-form compact-form" onSubmit={submit}><label>Tier name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="General admission" /></label><label>Description<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label><div className="form-row"><label>Price ({event.currency})<input type="number" min="0.01" step="0.01" required value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></label><label>Available<input type="number" min="1" step="1" required value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></label></div>{error && <div className="alert alert-error">{error}</div>}<button className="button button-dark">Add ticket tier ↗</button></form></section>
      <section className="content-card"><div className="eyebrow">YOUR TIERS</div><h3>Made for every guest</h3><div className="tier-list">{data.tiers.map((tier) => <article className="tier-item" key={tier.id}><span className="tier-icon">▤</span><div><strong>{tier.name}</strong><small>{tier.sold} of {tier.quantity} claimed</small></div><strong>{formatMoney(tier.price, event.currency)}</strong></article>)}{!data.tiers.length && <div className="empty-note">Ticket tiers you create will appear here.</div>}</div></section></div>
  </div>;
}

function VotingPanel({ eventId, data, onRefresh }: { eventId: string; data: WorkspaceData; onRefresh: () => void }) {
  const [category, setCategory] = useState("");
  const [candidate, setCandidate] = useState({ categoryId: "", name: "", description: "" });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  async function addCategory(event: FormEvent) {
    event.preventDefault(); setError("");
    try { await api(`/api/events/${eventId}/categories`, { method: "POST", body: JSON.stringify({ name: category }) }); setCategory(""); onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create category"); }
  }
  async function addCandidate(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      let photoKey: string | undefined;
      if (file) {
        const signed = await api<{ key: string; uploadUrl: string }>(`/api/events/${eventId}/uploads`, { method: "POST", body: JSON.stringify({ filename: file.name, contentType: file.type, contentLength: file.size }) });
        const upload = await fetch(signed.uploadUrl, { method: "PUT", headers: { "content-type": file.type }, body: file });
        if (!upload.ok) throw new Error("Candidate image upload failed");
        photoKey = signed.key;
      }
      await api(`/api/events/${eventId}/categories/${candidate.categoryId}/candidates`, { method: "POST", body: JSON.stringify({ name: candidate.name, description: candidate.description || undefined, photoKey }) });
      setCandidate({ categoryId: "", name: "", description: "" }); setFile(null); onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add candidate"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">LET THE PEOPLE DECIDE</div><h2>Contest & leaderboard</h2></div><span className="item-count">Public voting is live</span></div>
    <div className="two-column-panels"><section className="content-card"><div className="eyebrow">BUILD THE CONTEST</div><h3>Categories & candidates</h3><form className="inline-form" onSubmit={addCategory}><input required value={category} onChange={(e) => setCategory(e.target.value)} placeholder="New category name" /><button className="button button-outline">Add category</button></form>
      <form className="stack-form compact-form candidate-form" onSubmit={addCandidate}><label>Category<select required value={candidate.categoryId} onChange={(e) => setCandidate({ ...candidate, categoryId: e.target.value })}><option value="">Choose category</option>{data.categories.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Candidate name<input required value={candidate.name} onChange={(e) => setCandidate({ ...candidate, name: e.target.value })} /></label><label>Profile image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label><label>Description<input value={candidate.description} onChange={(e) => setCandidate({ ...candidate, description: e.target.value })} /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-dark">Add candidate ↗</button></form></section>
      <section className="content-card"><div className="eyebrow">LIVE LEADERBOARD</div><h3>How the votes are landing</h3>{data.categories.map((item) => <div className="leaderboard-category" key={item.id}><strong>{item.name}</strong>{item.candidates.map((person, index) => <div className="leader-row" key={person.id}><span className="leader-rank">{String(index + 1).padStart(2, "0")}</span><span>{person.name}</span><strong>{person.votesCount}</strong></div>)}{!item.candidates.length && <small className="muted">Add candidates to get started.</small>}</div>)}{!data.categories.length && <div className="empty-note">Start with a category on the left.</div>}</section></div>
  </div>;
}

function WeddingPanel({ eventId, data, onRefresh }: { eventId: string; data: WorkspaceData; onRefresh: () => void }) {
  const [budgetForm, setBudgetForm] = useState({ category: "", estimatedCost: "", actualCost: "", dueAt: "", vendorId: "", paid: false });
  const [vendorForm, setVendorForm] = useState({ name: "", service: "", phone: "", email: "", status: "SHORTLISTED", quotedCost: "", agreedCost: "", paidAmount: "", paymentDueAt: "" });
  const [registryForm, setRegistryForm] = useState({ title: "", category: "", url: "", price: "", quantity: 1 });
  const [error, setError] = useState("");
  async function submit(event: FormEvent, path: string, body: Record<string, unknown>, reset: () => void) {
    event.preventDefault(); setError("");
    try { await api(`/api/events/${eventId}/${path}`, { method: "POST", body: JSON.stringify(body) }); reset(); onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your details"); }
  }
  async function updateBudgetPaid(id: string, paid: boolean) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/budget/${id}`, { method: "PATCH", body: JSON.stringify({ paid }) });
      onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update budget payment status"); }
  }
  async function updateVendorStatus(id: string, status: string) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/vendors/${id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update vendor status"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">THE DETAILS THAT MAKE IT YOURS</div><h2>Wedding planning</h2></div></div>{error && <div className="alert alert-error">{error}</div>}
    <div className="wedding-grid">
      <section className="content-card"><div className="eyebrow">KEEP EVERY PENNY IN VIEW</div><h3>Budget tracker</h3><form className="stack-form compact-form" onSubmit={(e) => void submit(e, "budget", { category: budgetForm.category, estimatedCost: Number(budgetForm.estimatedCost), actualCost: budgetForm.actualCost ? Number(budgetForm.actualCost) : undefined, dueAt: budgetForm.dueAt ? new Date(budgetForm.dueAt).toISOString() : undefined, vendorId: budgetForm.vendorId || undefined, paid: budgetForm.paid }, () => setBudgetForm({ category: "", estimatedCost: "", actualCost: "", dueAt: "", vendorId: "", paid: false }))}>
        <label>Budget category<input required value={budgetForm.category} onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })} placeholder="Venue, catering..." /></label>
        <div className="form-row"><label>Estimated cost<input type="number" min="0" step="0.01" required value={budgetForm.estimatedCost} onChange={(e) => setBudgetForm({ ...budgetForm, estimatedCost: e.target.value })} /></label><label>Actual cost<input type="number" min="0" step="0.01" value={budgetForm.actualCost} onChange={(e) => setBudgetForm({ ...budgetForm, actualCost: e.target.value })} /></label></div>
        <div className="form-row"><label>Due date<input type="date" value={budgetForm.dueAt} onChange={(e) => setBudgetForm({ ...budgetForm, dueAt: e.target.value })} /></label><label>Vendor<select value={budgetForm.vendorId} onChange={(e) => setBudgetForm({ ...budgetForm, vendorId: e.target.value })}><option value="">No vendor</option>{data.vendors.map((vendor) => <option value={vendor.id} key={vendor.id}>{vendor.name}</option>)}</select></label></div>
        <label className="checkbox-label"><input type="checkbox" checked={budgetForm.paid} onChange={(e) => setBudgetForm({ ...budgetForm, paid: e.target.checked })} />Already paid</label>
        <button className="button button-outline">Add budget item</button></form>
        <div className="mini-list">{data.budget.map((item) => <div key={item.id}><span>{item.category}<small>{item.dueAt ? `Due ${formatDate(item.dueAt)}` : "No due date"}{item.vendorId ? ` · ${data.vendors.find((vendor) => vendor.id === item.vendorId)?.name ?? "Vendor"}` : ""}</small><label className="checkbox-label"><input type="checkbox" checked={item.paid} onChange={(e) => void updateBudgetPaid(item.id, e.target.checked)} />Paid</label></span><strong>{formatMoney(item.actualCost ?? item.estimatedCost)}</strong></div>)}{!data.budget.length && <small className="muted">Your budget items will appear here.</small>}</div>
      </section>
      <section className="content-card"><div className="eyebrow">GOOD PEOPLE, GOOD WORK</div><h3>Vendor directory</h3><form className="stack-form compact-form" onSubmit={(e) => void submit(e, "vendors", { ...vendorForm, quotedCost: vendorForm.quotedCost ? Number(vendorForm.quotedCost) : undefined, agreedCost: vendorForm.agreedCost ? Number(vendorForm.agreedCost) : undefined, paidAmount: vendorForm.paidAmount ? Number(vendorForm.paidAmount) : undefined, paymentDueAt: vendorForm.paymentDueAt ? new Date(vendorForm.paymentDueAt).toISOString() : undefined, phone: vendorForm.phone || undefined, email: vendorForm.email || undefined }, () => setVendorForm({ name: "", service: "", phone: "", email: "", status: "SHORTLISTED", quotedCost: "", agreedCost: "", paidAmount: "", paymentDueAt: "" }))}>
        <div className="form-row"><label>Name<input required value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} /></label><label>Service<input required value={vendorForm.service} onChange={(e) => setVendorForm({ ...vendorForm, service: e.target.value })} /></label></div>
        <div className="form-row"><label>Phone<input value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} /></label><label>Status<select value={vendorForm.status} onChange={(e) => setVendorForm({ ...vendorForm, status: e.target.value })}>{["SHORTLISTED", "CONTACTED", "QUOTED", "BOOKED", "COMPLETED", "CANCELLED"].map((status) => <option key={status} value={status}>{status.toLowerCase().replace("_", " ")}</option>)}</select></label></div>
        <div className="form-row"><label>Quote<input type="number" min="0" step="0.01" value={vendorForm.quotedCost} onChange={(e) => setVendorForm({ ...vendorForm, quotedCost: e.target.value })} /></label><label>Agreed cost<input type="number" min="0" step="0.01" value={vendorForm.agreedCost} onChange={(e) => setVendorForm({ ...vendorForm, agreedCost: e.target.value })} /></label></div>
        <div className="form-row"><label>Paid to date<input type="number" min="0" step="0.01" value={vendorForm.paidAmount} onChange={(e) => setVendorForm({ ...vendorForm, paidAmount: e.target.value })} /></label><label>Payment due<input type="date" value={vendorForm.paymentDueAt} onChange={(e) => setVendorForm({ ...vendorForm, paymentDueAt: e.target.value })} /></label></div>
        <button className="button button-outline">Add vendor</button></form>
        <div className="mini-list">{data.vendors.map((vendor) => <div key={vendor.id}><span>{vendor.name} <small>{vendor.service} · Quote {vendor.quotedCost ? formatMoney(vendor.quotedCost) : "—"} · Paid {vendor.paidAmount ? formatMoney(vendor.paidAmount) : formatMoney(0)}</small><small>{vendor.paymentDueAt ? `Payment due ${formatDate(vendor.paymentDueAt)}` : ""}</small></span><div><select aria-label={`Status for ${vendor.name}`} value={vendor.status ?? "SHORTLISTED"} onChange={(e) => void updateVendorStatus(vendor.id, e.target.value)}>{["SHORTLISTED", "CONTACTED", "QUOTED", "BOOKED", "COMPLETED", "CANCELLED"].map((status) => <option key={status} value={status}>{status.toLowerCase().replace("_", " ")}</option>)}</select><strong>{vendor.agreedCost ? formatMoney(vendor.agreedCost) : "—"}</strong></div></div>)}{!data.vendors.length && <small className="muted">Keep your trusted vendors close.</small>}</div>
      </section>
      <section className="content-card registry-card"><div className="eyebrow">A LITTLE SOMETHING LOVELY</div><h3>Gift registry</h3><form className="stack-form compact-form" onSubmit={(e) => void submit(e, "registry", { title: registryForm.title, category: registryForm.category || undefined, url: registryForm.url || undefined, price: registryForm.price ? Number(registryForm.price) : undefined, quantity: Number(registryForm.quantity) }, () => setRegistryForm({ title: "", category: "", url: "", price: "", quantity: 1 }))}>
        <label>Gift or contribution<input required value={registryForm.title} onChange={(e) => setRegistryForm({ ...registryForm, title: e.target.value })} placeholder="Registry item" /></label>
        <div className="form-row"><label>Category<input value={registryForm.category} onChange={(e) => setRegistryForm({ ...registryForm, category: e.target.value })} placeholder="Home, travel..." /></label><label>Quantity<input type="number" min="1" max="1000" required value={registryForm.quantity} onChange={(e) => setRegistryForm({ ...registryForm, quantity: Number(e.target.value) })} /></label></div>
        <div className="form-row"><label>Item link<input type="url" value={registryForm.url} onChange={(e) => setRegistryForm({ ...registryForm, url: e.target.value })} /></label><label>Price<input type="number" min="0" step="0.01" value={registryForm.price} onChange={(e) => setRegistryForm({ ...registryForm, price: e.target.value })} /></label></div>
        <button className="button button-outline">Add item</button></form>
        <div className="mini-list">{data.registry.map((item) => <div key={item.id}><span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a> : item.title}<small>{item.category || "Gift"} · {item.claimedCount ?? 0} / {item.quantity ?? 1} claimed</small></span><strong>{item.price ? formatMoney(item.price) : "—"}</strong></div>)}{!data.registry.length && <small className="muted">Your registry is ready to fill.</small>}</div>
      </section>
    </div>
  </div>;
}

function BroadcastPanel({ eventId, team = false }: { eventId: string; team?: boolean }) {
  type ScheduledMessage = {
    id: string;
    message: string;
    audience: "ALL_GUESTS" | "ATTENDING";
    scheduledAt: string;
    status: string;
    sentCount: number;
    failedCount: number;
    skippedCount: number;
  };
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [schedules, setSchedules] = useState<ScheduledMessage[]>([]);
  const [scheduledAt, setScheduledAt] = useState("");
  const [audience, setAudience] = useState<"ALL_GUESTS" | "ATTENDING">("ALL_GUESTS");
  const [scheduleBusy, setScheduleBusy] = useState(false);

  async function loadSchedules() {
    const data = await api<{ schedules: ScheduledMessage[] }>(`/api/events/${eventId}/message-schedules`);
    setSchedules(data.schedules);
  }

  useEffect(() => {
    void loadSchedules().catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "Could not load scheduled messages"),
    );
  }, [eventId]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult("");
    try {
      const summary = await api<{ recipients: number; sent: number; failed: number; skipped: number }>(`/api/events/${eventId}/broadcast`, { method: "POST", body: JSON.stringify({ message }) });
      setResult(`Accepted by mNotify for ${summary.sent} of ${summary.recipients} guests${summary.failed ? ` · ${summary.failed} failed` : ""}${summary.skipped ? ` · ${summary.skipped} opted out` : ""}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send update"); }
    finally { setBusy(false); }
  }

  async function scheduleMessage(event: FormEvent) {
    event.preventDefault();
    setScheduleBusy(true);
    setError("");
    setResult("");
    try {
      await api(`/api/events/${eventId}/message-schedules`, {
        method: "POST",
        body: JSON.stringify({ message, audience, scheduledAt: new Date(scheduledAt).toISOString() }),
      });
      setResult("Your SMS update is scheduled.");
      setScheduledAt("");
      await loadSchedules();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not schedule this update");
    } finally {
      setScheduleBusy(false);
    }
  }

  async function cancelSchedule(scheduleId: string) {
    setError("");
    try {
      await api(`/api/events/${eventId}/message-schedules/${scheduleId}`, { method: "DELETE" });
      await loadSchedules();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel this message");
    }
  }

  function TeamPanel({ eventId }: { eventId: string }) {
    const [staff, setStaff] = useState<{ userId: string; role: string; user: { name: string; email: string } }[]>([]);
    const [email, setEmail] = useState("");
    const [role, setRole] = useState("CHECK_IN_STAFF");
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");

    async function load() {
      const result = await api<{ staff: typeof staff }>(`/api/events/${eventId}/staff`);
      setStaff(result.staff);
    }
    useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not load event staff")); }, [eventId]);

    async function addStaff(event: FormEvent) {
      event.preventDefault(); setError(""); setMessage("");
      try {
        await api(`/api/events/${eventId}/staff`, { method: "POST", body: JSON.stringify({ email, role }) });
        setEmail(""); setMessage("Team member access updated."); await load();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add event staff"); }
    }
    async function removeStaff(userId: string) {
      setError(""); setMessage("");
      try {
        await api(`/api/events/${eventId}/staff/${userId}`, { method: "DELETE" });
        await load();
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove event staff"); }
    }

    return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">GOOD THINGS, TOGETHER</div><h2>Your event team</h2></div></div><div className="two-column-panels"><section className="content-card"><div className="eyebrow">BRING IN YOUR PEOPLE</div><h3>Give someone event access</h3><p className="muted small-copy">Administrators create accounts first. Check-in staff can scan passes; event managers can update event details.</p><form className="stack-form compact-form" onSubmit={(event) => void addStaff(event)}><label>Team member email<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" /></label><label>Event role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="CHECK_IN_STAFF">Check-in staff</option><option value="EVENT_MANAGER">Event manager</option></select></label>{error && <div className="alert alert-error">{error}</div>}{message && <div className="alert alert-success">{message}</div>}<button className="button button-dark">Grant event access ↗</button></form></section><section className="content-card"><div className="eyebrow">THE PEOPLE BEHIND IT</div><h3>{staff.length} team {staff.length === 1 ? "member" : "members"}</h3><div className="staff-list">{staff.map((member) => <div className="staff-item" key={member.userId}><span className="avatar">{member.user.name.slice(0, 1).toUpperCase()}</span><div><strong>{member.user.name}</strong><small>{member.user.email} · {member.role.toLowerCase().replaceAll("_", " ")}</small></div><button className="text-button" onClick={() => void removeStaff(member.userId)} aria-label={`Remove ${member.user.name}`}>Remove</button></div>)}{!staff.length && <div className="empty-note">No additional team members yet.</div>}</div></section></div></div>;
  }
  if (team) return <TeamPanel eventId={eventId} />;
  return <div className="workspace-body">
    <div className="section-heading"><div><div className="eyebrow">A NOTE TO YOUR PEOPLE</div><h2>Guest updates</h2></div></div>
    <section className="content-card broadcast-card">
      <span className="broadcast-icon">↗</span>
      <div className="eyebrow">SEND AN SMS UPDATE</div>
      <h3>Keep everyone in the loop.</h3>
      <p className="muted">Your update will go to the guests on this event’s list. Delivery results are recorded in the event SMS log. Guests who opted out will be skipped.</p>
      <form className="stack-form" onSubmit={submit}>
        <label>Message<textarea required maxLength={1000} rows={5} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="A little update for your guests..." /><small className="muted">{message.length} / 1000 characters</small></label>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {result && <div className="alert alert-success" role="status">{result}</div>}
        <button className="button button-dark" disabled={busy || !message.trim()}>{busy ? <CubeLoader label="Update" compact /> : <>Send update <span>↗</span></>}</button>
      </form>
    </section>
    <section className="content-card admin-form">
      <div className="eyebrow">PLAN AHEAD</div>
      <h3>Schedule an SMS update</h3>
      <p className="muted small-copy">Use <code>{"{name}"}</code> and <code>{"{event}"}</code> to personalize each message. Duplicate phone numbers are only sent once.</p>
      <form className="stack-form compact-form" onSubmit={scheduleMessage}>
        <label>Message<textarea required maxLength={1000} rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="A little update for your guests..." /></label>
        <div className="form-row">
          <label>Send to<select value={audience} onChange={(event) => setAudience(event.target.value as "ALL_GUESTS" | "ATTENDING")}><option value="ALL_GUESTS">All guests</option><option value="ATTENDING">Attending guests</option></select></label>
          <label>Send at<input required type="datetime-local" value={scheduledAt} min={new Date(Date.now() + 2 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} /></label>
        </div>
        <button className="button button-dark" disabled={scheduleBusy || !message.trim() || !scheduledAt}>{scheduleBusy ? <CubeLoader label="Schedule" compact /> : <>Schedule update <span>↗</span></>}</button>
      </form>
      <div className="admin-form">
        <h3>Scheduled message history</h3>
        {schedules.length ? <div className="schedule-list">{schedules.map((schedule) => <article className="admin-list-item" key={schedule.id}>
          <strong>{new Date(schedule.scheduledAt).toLocaleString()} · {schedule.audience === "ATTENDING" ? "Attending guests" : "All guests"}</strong>
          <small><span className={`status-pill ${schedule.status.toLowerCase()}`}>{schedule.status.toLowerCase()}</span> · {schedule.sentCount} sent · {schedule.failedCount} failed · {schedule.skippedCount} opted out</small>
          <p>{schedule.message}</p>
          {schedule.status === "SCHEDULED" && new Date(schedule.scheduledAt) > new Date() && <button className="text-button" onClick={() => void cancelSchedule(schedule.id)}>Cancel scheduled message</button>}
        </article>)}</div> : <p className="muted small-copy">No messages scheduled yet.</p>}
      </div>
    </section>
  </div>;
}
