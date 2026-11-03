import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "../App";
import { api, formatDate, formatMoney } from "../api";
import { AdminPanel } from "./AdminPanel";

interface EventItem {
  id: string;
  slug: string;
  title: string;
  type: "WEDDING" | "VOTING" | "GENERAL";
  startDate: string;
  endDate: string;
  durationDays: number;
  totalCost: string;
  currency: string;
  location: string;
}

const eventLabels = {
  WEDDING: "Wedding",
  VOTING: "Voting & contest",
  GENERAL: "General event",
};

export function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdmin, setShowAdmin] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  async function loadEvents() {
    try {
      const result = await api<{ events: EventItem[] }>("/api/events");
      setEvents(result.events);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadEvents(); }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
    navigate("/login");
  }

  const eventCount = events.length;
  const upcoming = events.filter((event) => new Date(event.endDate) >= new Date()).length;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
        <div className="side-label">WORKSPACE</div>
        <Link className="side-link active" to="/dashboard"><span>▦</span> Overview</Link>
        <div className="side-label side-spaced">YOUR EVENTS</div>
        {events.slice(0, 5).map((event) => <Link className="side-link side-event" key={event.id} to={user.role === "CHECK_IN_STAFF" ? `/scanner/${event.id}` : `/events/${event.id}`}><span className={`event-dot ${event.type.toLowerCase()}`} />{event.title}</Link>)}
        <button className="side-add" onClick={() => setShowCreate(true)} disabled={user.role === "CHECK_IN_STAFF"}>＋ Create an event</button>
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ").toLowerCase()}</small></span></div>
          <button className="text-button" onClick={() => void logout()}>Sign out ↗</button>
        </div>
      </aside>
      <section className="main-content">
        <header className="topbar"><span className="breadcrumb">Workspace <span>/</span> Overview</span><span className="today-label">{new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</span></header>
        <div className="page-heading">
          <div><div className="eyebrow">YOUR SPACE, ALL IN ONE PLACE</div><h1>Good morning, {user.name.split(" ")[0]} <span className="heading-spark">✳</span></h1><p>Here’s what’s happening across your events.</p></div>
          <div className="heading-actions">{user.role === "ADMIN" && <button className="button button-outline" onClick={() => setShowAdmin(true)}>⚙ Platform</button>}{user.role !== "CHECK_IN_STAFF" && <button className="button button-dark" onClick={() => setShowCreate(true)}>＋ New event</button>}</div>
        </div>
        <div className="stat-grid">
          <div className="stat-card"><span className="stat-icon sage">◈</span><span className="stat-label">Total events</span><strong>{loading ? "—" : eventCount.toString().padStart(2, "0")}</strong><small>Your moments, in motion</small></div>
          <div className="stat-card"><span className="stat-icon peach">◷</span><span className="stat-label">Coming up</span><strong>{loading ? "—" : upcoming.toString().padStart(2, "0")}</strong><small>On the near horizon</small></div>
          <div className="stat-card stat-highlight"><span className="stat-icon cream">✳</span><span className="stat-label">A little reminder</span><strong>Make it<br />meaningful.</strong><small>We’ll help with the rest.</small></div>
        </div>
        <div className="section-heading"><div><div className="eyebrow">THE BIG PICTURE</div><h2>Your events</h2></div><span className="item-count">{eventCount} {eventCount === 1 ? "event" : "events"}</span></div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {loading ? <div className="empty-panel">Gathering your event details...</div> : events.length ? (
          <div className="event-grid">
            {events.map((event) => (
              <article className="event-card" key={event.id}>
                <div className={`event-card-art ${event.type.toLowerCase()}`}><span className="event-card-type">{eventLabels[event.type]}</span><span className="event-art-symbol">{event.type === "WEDDING" ? "✿" : event.type === "VOTING" ? "✳" : "◈"}</span><span className="event-art-index">EVENTFLOW / {event.type.slice(0, 3)}</span></div>
                <div className="event-card-body">
                  <div className="event-card-title"><h3>{event.title}</h3><span aria-hidden="true">↗</span></div>
                  <div className="event-meta"><span>◷ &nbsp;{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</span><span>⌖ &nbsp;{event.location}</span></div>
                  <div className="event-card-footer"><span>{event.durationDays} billable {event.durationDays === 1 ? "day" : "days"}</span><strong>{formatMoney(event.totalCost, event.currency)}</strong></div>
                  <Link className="event-card-link" to={user.role === "CHECK_IN_STAFF" ? `/scanner/${event.id}` : `/events/${event.id}`} aria-label={`${user.role === "CHECK_IN_STAFF" ? "Scan for" : "Manage"} ${event.title}`} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-panel empty-illustration"><div className="empty-flower">✿</div><h3>Your next favorite memory starts here.</h3><p>Create an event to bring all the thoughtful details together.</p>{user.role !== "CHECK_IN_STAFF" && <button className="button button-outline" onClick={() => setShowCreate(true)}>Create your first event <span>↗</span></button>}</div>
        )}
      </section>
      {showCreate && <CreateEvent onClose={() => setShowCreate(false)} onCreated={(id) => navigate(`/events/${id}`)} />}
      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
    </main>
  );
}

function CreateEvent({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", type: "WEDDING", startDate: "", endDate: "", location: "", description: "", voteUnitPrice: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ event: { id: string } }>("/api/events", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          voteUnitPrice: form.type === "VOTING" && form.voteUnitPrice
            ? Number(form.voteUnitPrice)
            : undefined,
        }),
      });
      onCreated(result.event.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create event");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        <div className="eyebrow">A NEW CHAPTER</div><h2 id="create-title">Create an event</h2><p className="muted">Every great gathering begins with a few details.</p>
        <form className="stack-form" onSubmit={submit}>
          <label>Event name<input required minLength={2} maxLength={160} value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="A celebration to remember" /></label>
          <label>Event type<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="WEDDING">Wedding</option><option value="VOTING">Voting & contest</option><option value="GENERAL">General event / awards</option></select></label>
          {form.type === "VOTING" && <label>Paid vote price per vote (GHS) <span className="muted">optional</span><input type="number" min="0.01" step="0.01" value={form.voteUnitPrice} onChange={(event) => setForm({ ...form, voteUnitPrice: event.target.value })} placeholder="Leave blank for free votes only" /></label>}
          <div className="form-row"><label>Starts<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Ends<input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>
          <label>Location<input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="City, venue, or online" /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="button button-dark button-wide" disabled={busy}>{busy ? "Creating..." : "Create event"} <span>↗</span></button>
        </form>
      </section>
    </div>
  );
}
