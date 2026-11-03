import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type { User } from "../App";
import { api, formatDate, formatMoney } from "../api";

interface EventData {
  id: string;
  slug: string;
  title: string;
  type: "WEDDING" | "VOTING" | "GENERAL";
  startDate: string;
  endDate: string;
  durationDays: number;
  totalCost: string;
  dailyRate: string;
  currency: string;
  location: string;
  description?: string | null;
  _count: { guests: number; categories: number; orders: number };
}
interface Guest {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  status: string;
  plusOnes: number;
  dietary?: string | null;
  checkedInAt?: string | null;
}
interface Category {
  id: string;
  name: string;
  candidates: { id: string; name: string; description?: string | null; votesCount: number }[];
}
interface WorkspaceData {
  guests: Guest[];
  categories: Category[];
  budget: { id: string; category: string; estimatedCost: string; actualCost?: string | null; paid: boolean }[];
  vendors: { id: string; name: string; service: string; phone?: string | null; email?: string | null; agreedCost?: string | null }[];
  registry: { id: string; title: string; url?: string | null; price?: string | null; claimed: boolean }[];
  sessions: { id: string; title: string; startsAt: string; endsAt: string; location?: string | null; speaker?: string | null }[];
  tiers: { id: string; name: string; price: string; quantity: number; sold: number }[];
}

const emptyData: WorkspaceData = {
  guests: [], categories: [], budget: [], vendors: [], registry: [], sessions: [], tiers: [],
};

const tabs = [
  ["overview", "Overview"],
  ["guests", "Guests"],
  ["programme", "Programme"],
  ["tickets", "Tickets"],
  ["engage", "Engage"],
  ["wedding", "Wedding details"],
  ["updates", "Updates"],
  ["team", "Event team"],
] as const;

export function EventWorkspace({ user }: { user: User }) {
  const { eventId = "" } = useParams();
  const [event, setEvent] = useState<EventData | null>(null);
  const [data, setData] = useState(emptyData);
  const [tab, setTab] = useState<string>("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { event: current } = await api<{ event: EventData }>(`/api/events/${eventId}`);
      setEvent(current);
      const results = await Promise.all([
        api<{ guests: Guest[] }>(`/api/events/${eventId}/guests`),
        api<{ budget: WorkspaceData["budget"] }>(`/api/events/${eventId}/budget`),
        api<{ vendors: WorkspaceData["vendors"] }>(`/api/events/${eventId}/vendors`),
        api<{ items: WorkspaceData["registry"] }>(`/api/events/${eventId}/registry`),
        api<{ categories: Category[] }>(`/api/events/${eventId}/categories`),
        api<{ sessions: WorkspaceData["sessions"] }>(`/api/events/${eventId}/sessions`),
        api<{ tiers: WorkspaceData["tiers"] }>(`/api/events/${eventId}/ticket-tiers`),
      ]);
      setData({
        guests: results[0].guests,
        budget: results[1].budget,
        vendors: results[2].vendors,
        registry: results[3].items,
        categories: results[4].categories,
        sessions: results[5].sessions,
        tiers: results[6].tiers,
      });
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this event");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [eventId]);

  const isWedding = event?.type === "WEDDING";
  const isVoting = event?.type === "VOTING";
  const visibleTabs = tabs.filter(([key]) => {
    if (key === "wedding") return isWedding;
    if (key === "engage") return isVoting;
    return true;
  });

  if (loading) return <main className="loading-screen">Gathering your event details...</main>;
  if (!event) return <main className="center-card"><div className="alert alert-error">{error || "Event not found"}</div><Link to="/dashboard" className="button button-outline">Return to workspace</Link></main>;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
        <div className="side-label">EVENT SPACE</div>
        <Link className="side-link" to="/dashboard"><span>←</span> All events</Link>
        <div className="event-sidebar-card"><span className={`event-dot ${event.type.toLowerCase()}`} /><div><strong>{event.title}</strong><small>{event.type.replace("_", " ").toLowerCase()}</small></div></div>
        <div className="side-label side-spaced">MANAGE</div>
        {visibleTabs.map(([key, label]) => <button key={key} className={`side-link side-button ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}><span>{iconForTab(key)}</span>{label}</button>)}
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ").toLowerCase()}</small></span></div>
          <Link className="text-button" to={`/e/${event.slug}`} target="_blank" rel="noreferrer">View public page ↗</Link>
        </div>
      </aside>
      <section className="main-content">
        <header className="topbar"><span className="breadcrumb"><Link to="/dashboard">Workspace</Link> <span>/</span> {event.title}</span><Link className="topbar-link" to={`/scanner/${event.id}`}>Open gate scanner ↗</Link></header>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <div className="event-workspace-heading">
          <div className={`event-cover-mark ${event.type.toLowerCase()}`}>{event.type === "WEDDING" ? "✿" : event.type === "VOTING" ? "✳" : "◈"}</div>
          <div className="event-heading-copy"><div className="eyebrow">{event.type.replace("_", " ")} · YOUR EVENT</div><h1>{event.title}</h1><p>⌖ &nbsp;{event.location} <span className="heading-divider">·</span> ◷ &nbsp;{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</p></div>
          <a className="button button-outline" href={`/e/${event.slug}`} target="_blank" rel="noreferrer">Public page ↗</a>
        </div>
        <nav className="workspace-tabs" aria-label="Event sections">{visibleTabs.map(([key, label]) => <button key={key} className={tab === key ? "selected" : ""} onClick={() => setTab(key)}>{label}</button>)}</nav>
        {tab === "overview" && <Overview event={event} data={data} onSelect={setTab} />}
        {tab === "guests" && <GuestsPanel eventId={event.id} data={data} onRefresh={load} />}
        {tab === "programme" && <ProgrammePanel eventId={event.id} data={data} onRefresh={load} />}
        {tab === "tickets" && <TicketsPanel eventId={event.id} event={event} data={data} onRefresh={load} />}
        {tab === "engage" && <VotingPanel eventId={event.id} data={data} onRefresh={load} />}
        {tab === "wedding" && <WeddingPanel eventId={event.id} data={data} onRefresh={load} />}
        {tab === "updates" && <BroadcastPanel eventId={event.id} />}
        {tab === "team" && <BroadcastPanel eventId={event.id} team />}
      </section>
    </main>
  );
}

function iconForTab(tab: string): string {
  return ({ overview: "◈", guests: "♧", programme: "◷", tickets: "▤", engage: "✳", wedding: "♡", updates: "↗" } as Record<string, string>)[tab] ?? "·";
}

function Overview({ event, data, onSelect }: { event: EventData; data: WorkspaceData; onSelect: (tab: string) => void }) {
  const checkins = data.guests.filter((guest) => guest.checkedInAt).length;
  return (
    <div className="workspace-body">
      <div className="stat-grid event-stats">
        <div className="stat-card"><span className="stat-label">Guest list</span><strong>{data.guests.length.toString().padStart(2, "0")}</strong><small>{checkins} checked in so far</small></div>
        <div className="stat-card"><span className="stat-label">Event duration</span><strong>{event.durationDays} <small className="inline-unit">days</small></strong><small>Inclusive calendar dates</small></div>
        <div className="stat-card"><span className="stat-label">Platform pricing</span><strong className="stat-money">{formatMoney(event.totalCost, event.currency)}</strong><small>{formatMoney(event.dailyRate, event.currency)} per day</small></div>
        <div className="stat-card"><span className="stat-label">Tickets reserved</span><strong>{event._count.orders.toString().padStart(2, "0")}</strong><small>Paid orders</small></div>
      </div>
      <div className="two-column-panels">
        <section className="content-card"><div className="section-heading compact"><div><div className="eyebrow">KEEP THINGS MOVING</div><h2>Quick links</h2></div></div><div className="quick-links">
          <button onClick={() => onSelect("guests")}><span className="quick-icon sage">♧</span><span><strong>Invite your people</strong><small>Build your guest list</small></span><b>↗</b></button>
          <button onClick={() => onSelect(event.type === "VOTING" ? "engage" : "programme")}><span className="quick-icon peach">✳</span><span><strong>{event.type === "VOTING" ? "Set up the contest" : "Plan the programme"}</strong><small>Bring the details together</small></span><b>↗</b></button>
          <button onClick={() => onSelect("tickets")}><span className="quick-icon cream">▤</span><span><strong>Set up ticketing</strong><small>Make passes easy to find</small></span><b>↗</b></button>
        </div></section>
        <section className="content-card"><div className="eyebrow">ON THE CALENDAR</div><h2>The when & where</h2><div className="detail-list"><div><span>Starts</span><strong>{formatDate(event.startDate)}</strong></div><div><span>Ends</span><strong>{formatDate(event.endDate)}</strong></div><div><span>Location</span><strong>{event.location}</strong></div><div><span>Public page</span><a href={`/e/${event.slug}`} target="_blank" rel="noreferrer">eventflow / {event.slug} ↗</a></div></div></section>
      </div>
    </div>
  );
}

function GuestsPanel({ eventId, data, onRefresh }: { eventId: string; data: WorkspaceData; onRefresh: () => void }) {
  const [form, setForm] = useState({ name: "", phone: "", email: "", plusOnes: 0, dietary: "" });
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setResult("");
    try {
      const response = await api<{ rsvpUrl: string; smsStatus: string }>(`/api/events/${eventId}/guests`, { method: "POST", body: JSON.stringify({ ...form, email: form.email || undefined, plusOnes: Number(form.plusOnes), dietary: form.dietary || undefined }) });
      setResult(`Invite sent (${response.smsStatus.toLowerCase()}). RSVP link: ${response.rsvpUrl}`);
      setForm({ name: "", phone: "", email: "", plusOnes: 0, dietary: "" });
      onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add guest"); }
    finally { setBusy(false); }
  }

  return <div className="workspace-body">
    <div className="section-heading"><div><div className="eyebrow">YOUR PEOPLE, ALL TOGETHER</div><h2>Guest list <span className="heading-count">{data.guests.length}</span></h2></div></div>
    <div className="two-column-panels guest-layout">
      <section className="content-card"><div className="eyebrow">SEND AN INVITATION</div><h3>Add a guest</h3><p className="muted small-copy">They’ll receive a private RSVP link by SMS.</p><form className="stack-form compact-form" onSubmit={submit}>
        <label>Full name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Guest name" /></label>
        <label>Phone<input required type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+233 24 000 0000" /></label>
        <label>Email <span className="muted">(optional)</span><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="guest@example.com" /></label>
        <div className="form-row"><label>Plus-one allowance<input type="number" min="0" max="20" value={form.plusOnes} onChange={(e) => setForm({ ...form, plusOnes: Number(e.target.value) })} /></label><label>Dietary note<input value={form.dietary} onChange={(e) => setForm({ ...form, dietary: e.target.value })} placeholder="Optional" /></label></div>
        {error && <div className="alert alert-error">{error}</div>}{result && <div className="alert alert-success">{result}</div>}
        <button className="button button-dark" disabled={busy}>{busy ? "Sending..." : "Add guest & invite"} <span>↗</span></button>
      </form></section>
      <section className="content-card table-card"><div className="table-scroll"><table><thead><tr><th>GUEST</th><th>RESPONSE</th><th>PLUS-ONES</th><th>DIETARY</th></tr></thead><tbody>
        {data.guests.map((guest) => <tr key={guest.id}><td><strong>{guest.name}</strong><small>{guest.phone}</small></td><td><span className={`status-pill ${guest.status.toLowerCase()}`}>{guest.status.toLowerCase()}</span></td><td>{guest.plusOnes}</td><td>{guest.dietary || <span className="muted">—</span>}</td></tr>)}
        {!data.guests.length && <tr><td colSpan={4} className="table-empty">Your guest list is ready when you are.</td></tr>}
      </tbody></table></div></section>
    </div>
  </div>;
}

function ProgrammePanel({ eventId, data, onRefresh }: { eventId: string; data: WorkspaceData; onRefresh: () => void }) {
  const [form, setForm] = useState({ title: "", startsAt: "", endsAt: "", location: "", speaker: "", description: "" });
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    try {
      await api(`/api/events/${eventId}/sessions`, { method: "POST", body: JSON.stringify({ ...form, startsAt: new Date(form.startsAt).toISOString(), endsAt: new Date(form.endsAt).toISOString(), description: form.description || undefined, location: form.location || undefined, speaker: form.speaker || undefined }) });
      setForm({ title: "", startsAt: "", endsAt: "", location: "", speaker: "", description: "" }); onRefresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add session"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">A THOUGHTFUL FLOW</div><h2>Programme & sessions</h2></div></div>
    <div className="two-column-panels"><section className="content-card"><div className="eyebrow">MAKE A MOMENT OF IT</div><h3>Add a session</h3><form className="stack-form compact-form" onSubmit={submit}><label>Session title<input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label><div className="form-row"><label>Starts<input required type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} /></label><label>Ends<input required type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} /></label></div><label>Location<input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></label><label>Speaker<input value={form.speaker} onChange={(e) => setForm({ ...form, speaker: e.target.value })} /></label>{error && <div className="alert alert-error">{error}</div>}<button className="button button-dark">Add to programme ↗</button></form></section>
      <section className="content-card"><div className="eyebrow">THE RUN OF SHOW</div><h3>{data.sessions.length} scheduled moments</h3><div className="session-list">{data.sessions.map((session) => <article className="session-item" key={session.id}><span className="session-time">{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(session.startsAt))}</span><div><strong>{session.title}</strong><small>{session.location || "Location to be announced"}{session.speaker ? ` · ${session.speaker}` : ""}</small></div><span className="session-date">{formatDate(session.startsAt)}</span></article>)}{!data.sessions.length && <div className="empty-note">Your programme is a blank canvas.</div>}</div></section></div>
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
  const [budgetForm, setBudgetForm] = useState({ category: "", estimatedCost: "", actualCost: "" });
  const [vendorForm, setVendorForm] = useState({ name: "", service: "", phone: "", email: "", agreedCost: "" });
  const [registryForm, setRegistryForm] = useState({ title: "", url: "", price: "" });
  const [error, setError] = useState("");
  async function submit(event: FormEvent, path: string, body: Record<string, unknown>, reset: () => void) {
    event.preventDefault(); setError("");
    try { await api(`/api/events/${eventId}/${path}`, { method: "POST", body: JSON.stringify(body) }); reset(); onRefresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save your details"); }
  }
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">THE DETAILS THAT MAKE IT YOURS</div><h2>Wedding planning</h2></div></div>{error && <div className="alert alert-error">{error}</div>}
    <div className="wedding-grid">
      <section className="content-card"><div className="eyebrow">KEEP EVERY PENNY IN VIEW</div><h3>Budget tracker</h3><form className="stack-form compact-form" onSubmit={(e) => void submit(e, "budget", { category: budgetForm.category, estimatedCost: Number(budgetForm.estimatedCost), actualCost: budgetForm.actualCost ? Number(budgetForm.actualCost) : undefined }, () => setBudgetForm({ category: "", estimatedCost: "", actualCost: "" }))}><label>Budget category<input required value={budgetForm.category} onChange={(e) => setBudgetForm({ ...budgetForm, category: e.target.value })} placeholder="Venue, catering..." /></label><div className="form-row"><label>Estimated cost<input type="number" min="0" step="0.01" required value={budgetForm.estimatedCost} onChange={(e) => setBudgetForm({ ...budgetForm, estimatedCost: e.target.value })} /></label><label>Actual cost<input type="number" min="0" step="0.01" value={budgetForm.actualCost} onChange={(e) => setBudgetForm({ ...budgetForm, actualCost: e.target.value })} /></label></div><button className="button button-outline">Add budget item</button></form><div className="mini-list">{data.budget.map((item) => <div key={item.id}><span>{item.category}</span><strong>{formatMoney(item.actualCost ?? item.estimatedCost)}</strong></div>)}{!data.budget.length && <small className="muted">Your budget items will appear here.</small>}</div></section>
      <section className="content-card"><div className="eyebrow">GOOD PEOPLE, GOOD WORK</div><h3>Vendor directory</h3><form className="stack-form compact-form" onSubmit={(e) => void submit(e, "vendors", { ...vendorForm, agreedCost: vendorForm.agreedCost ? Number(vendorForm.agreedCost) : undefined, phone: vendorForm.phone || undefined, email: vendorForm.email || undefined }, () => setVendorForm({ name: "", service: "", phone: "", email: "", agreedCost: "" }))}><div className="form-row"><label>Name<input required value={vendorForm.name} onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })} /></label><label>Service<input required value={vendorForm.service} onChange={(e) => setVendorForm({ ...vendorForm, service: e.target.value })} /></label></div><div className="form-row"><label>Phone<input value={vendorForm.phone} onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })} /></label><label>Agreed cost<input type="number" min="0" step="0.01" value={vendorForm.agreedCost} onChange={(e) => setVendorForm({ ...vendorForm, agreedCost: e.target.value })} /></label></div><button className="button button-outline">Add vendor</button></form><div className="mini-list">{data.vendors.map((vendor) => <div key={vendor.id}><span>{vendor.name} <small>{vendor.service}</small></span><strong>{vendor.agreedCost ? formatMoney(vendor.agreedCost) : "—"}</strong></div>)}{!data.vendors.length && <small className="muted">Keep your trusted vendors close.</small>}</div></section>
      <section className="content-card registry-card"><div className="eyebrow">A LITTLE SOMETHING LOVELY</div><h3>Gift registry</h3><form className="inline-form" onSubmit={(e) => void submit(e, "registry", { title: registryForm.title, url: registryForm.url || undefined, price: registryForm.price ? Number(registryForm.price) : undefined }, () => setRegistryForm({ title: "", url: "", price: "" }))}><input required value={registryForm.title} onChange={(e) => setRegistryForm({ ...registryForm, title: e.target.value })} placeholder="Registry item" /><input value={registryForm.url} onChange={(e) => setRegistryForm({ ...registryForm, url: e.target.value })} placeholder="Item link" /><button className="button button-outline">Add item</button></form><div className="mini-list">{data.registry.map((item) => <div key={item.id}><span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a> : item.title}</span><strong>{item.price ? formatMoney(item.price) : "—"}</strong></div>)}{!data.registry.length && <small className="muted">Your registry is ready to fill.</small>}</div></section>
    </div>
  </div>;
}

function BroadcastPanel({ eventId, team = false }: { eventId: string; team?: boolean }) {
  const [message, setMessage] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResult("");
    try {
      const summary = await api<{ recipients: number; sent: number; failed: number }>(`/api/events/${eventId}/broadcast`, { method: "POST", body: JSON.stringify({ message }) });
      setResult(`Accepted by mNotify for ${summary.sent} of ${summary.recipients} guests${summary.failed ? ` · ${summary.failed} failed` : ""}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send update"); }
    finally { setBusy(false); }
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
  return <div className="workspace-body"><div className="section-heading"><div><div className="eyebrow">A NOTE TO YOUR PEOPLE</div><h2>Guest updates</h2></div></div><section className="content-card broadcast-card"><span className="broadcast-icon">↗</span><div className="eyebrow">SEND AN SMS UPDATE</div><h3>Keep everyone in the loop.</h3><p className="muted">Your update will go to the guests on this event’s list. Delivery results are recorded in the event SMS log.</p><form className="stack-form" onSubmit={submit}><label>Message<textarea required maxLength={1000} rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="A little update for your guests..." /><small className="muted">{message.length} / 1000 characters</small></label>{error && <div className="alert alert-error">{error}</div>}{result && <div className="alert alert-success">{result}</div>}<button className="button button-dark" disabled={busy || !message.trim()}>{busy ? "Sending..." : "Send update"} <span>↗</span></button></form></section></div>;
}
