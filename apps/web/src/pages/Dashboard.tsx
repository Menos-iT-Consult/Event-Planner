import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { User } from "../App";
import { api, formatDate, formatMoney } from "../api";
import { CubeLoader } from "../components/CubeLoader";
import { eventProducts, getEventProduct } from "../products";

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

export function Dashboard({ user, onLogout, eventType }: { user: User; onLogout: () => void; eventType?: EventItem["type"] }) {
  const [events, setEvents] = useState<EventItem[]>([]);
  const [showCreate, setShowCreate] = useState(false);
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

  async function changePassword() {
    const currentPassword = window.prompt("Current password");
    const newPassword = window.prompt("New password (at least 12 characters)");
    if (!currentPassword || !newPassword) return;
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setError("");
      window.alert("Password changed.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change password");
    }
  }

  async function setupTwoFactor() {
    navigate("/security/two-factor");
  }

  async function disableTwoFactor() {
    navigate("/security/two-factor");
  }

  const productEvents = eventType ? events.filter((event) => event.type === eventType) : [];
  const eventCount = productEvents.length;
  const upcoming = productEvents.filter((event) => new Date(event.endDate) >= new Date()).length;
  const product = eventType ? getEventProduct(eventType) : null;

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link>
        <div className="side-label">PRODUCTS</div>
        <Link className={`side-link ${!product ? "active" : ""}`} to="/dashboard"><span>00</span> Product home</Link>
        {eventProducts.map((item, index) => <Link className={`side-link ${product?.type === item.type ? "active" : ""}`} key={item.type} to={item.path}><span>{String(index + 1).padStart(2, "0")}</span>{item.name}</Link>)}
        {user.role === "ADMIN" && <Link className="side-link" to="/admin"><span>AD</span> Central admin</Link>}
        {product && <>
          <div className="side-label side-spaced">YOUR {product.name.toUpperCase()}</div>
          {productEvents.slice(0, 5).map((event) => <Link className="side-link side-event" key={event.id} to={user.role === "CHECK_IN_STAFF" ? `/scanner/${event.id}` : `/events/${event.id}`}><span className={`event-dot ${event.type.toLowerCase()}`} />{event.title}</Link>)}
          <button className="side-add" onClick={() => setShowCreate(true)} disabled={user.role === "CHECK_IN_STAFF"}>Create {product.eventName}</button>
        </>}
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span><strong>{user.name}</strong><small>{user.role.replaceAll("_", " ").toLowerCase()}</small></span></div>
          <button className="text-button" onClick={() => void changePassword()}>Change password</button>
          <button className="text-button" onClick={() => void setupTwoFactor()}>Set up two-factor</button>
          <button className="text-button" onClick={() => void disableTwoFactor()}>Disable two-factor</button>
          <button className="text-button" onClick={() => void logout()}>Sign out</button>
        </div>
      </aside>
      <section className="main-content">
        <header className="topbar"><span className="breadcrumb">EventFlow <span>/</span> {product?.name ?? "Product home"}</span><span className="today-label">{new Intl.DateTimeFormat(undefined, { dateStyle: "full" }).format(new Date())}</span></header>
        <div className="page-heading">
          <div><div className="eyebrow">{product ? product.name.toUpperCase() : "YOUR EVENTFLOW WORKSPACE"}</div><h1>Good morning, {user.name.split(" ")[0]}</h1><p>{product ? product.description : "Choose a dedicated workspace for the kind of event you’re planning."}</p></div>
          <div className="heading-actions">{user.role === "ADMIN" && <Link className="button button-outline" to="/admin">Central admin</Link>}{product && user.role !== "CHECK_IN_STAFF" && <button className="button button-dark" onClick={() => setShowCreate(true)}>New {product.eventName}</button>}</div>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {!product ? <section className="product-hub">
          <div className="section-heading"><div><div className="eyebrow">CHOOSE YOUR WORKSPACE</div><h2>Every event, its own space.</h2></div></div>
          <div className="product-hub-grid">
            {eventProducts.map((item, index) => {
              const count = events.filter((event) => event.type === item.type).length;
              return <article className={`product-hub-card ${item.type.toLowerCase()}`} key={item.type}>
                <span className="eyebrow">0{index + 1} · EVENTFLOW</span>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
                <ul>{item.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
                <div className="product-hub-footer"><span>{loading ? "Loading events…" : `${count} ${count === 1 ? "event" : "events"}`}</span><Link className="button button-dark" to={item.path}>Open workspace</Link></div>
              </article>;
            })}
          </div>
        </section> : <>
        <div className="stat-grid">
          <div className="stat-card"><span className="stat-icon sage">01</span><span className="stat-label">Your events</span><strong>{loading ? "—" : eventCount.toString().padStart(2, "0")}</strong><small>In this workspace</small></div>
          <div className="stat-card"><span className="stat-icon peach">02</span><span className="stat-label">Coming up</span><strong>{loading ? "—" : upcoming.toString().padStart(2, "0")}</strong><small>On the near horizon</small></div>
          <div className="stat-card stat-highlight"><span className="stat-icon cream">03</span><span className="stat-label">A little reminder</span><strong>Make it<br />meaningful.</strong><small>We’ll help with the rest.</small></div>
        </div>
        <div className="section-heading"><div><div className="eyebrow">{product.name.toUpperCase()}</div><h2>Your {product.dashboardTitle.toLowerCase()}</h2></div><span className="item-count">{eventCount} {eventCount === 1 ? "event" : "events"}</span></div>
        {loading ? <div className="empty-panel"><CubeLoader label={product.name} /></div> : productEvents.length ? (
          <div className="event-grid">
            {productEvents.map((event) => (
              <article className="event-card" key={event.id}>
                <div className={`event-card-art ${event.type.toLowerCase()}`}><span className="event-card-type">{eventLabels[event.type]}</span><span className="event-art-symbol">{event.type}</span><span className="event-art-index">EVENTFLOW / {event.type.slice(0, 3)}</span></div>
                <div className="event-card-body">
                  <div className="event-card-title"><h3>{event.title}</h3></div>
                  <div className="event-meta"><span>{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</span><span>{event.location}</span></div>
                  <div className="event-card-footer"><span>{event.durationDays} billable {event.durationDays === 1 ? "day" : "days"}</span><strong>{formatMoney(event.totalCost, event.currency)}</strong></div>
                  <Link className="event-card-link" to={user.role === "CHECK_IN_STAFF" ? `/scanner/${event.id}` : `/events/${event.id}`} aria-label={`${user.role === "CHECK_IN_STAFF" ? "Scan for" : "Manage"} ${event.title}`} />
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-panel empty-illustration"><div className="empty-flower">01</div><h3>Your next favorite memory starts here.</h3><p>Create your first {product.name.toLowerCase()} event to get started.</p>{user.role !== "CHECK_IN_STAFF" && <button className="button button-outline" onClick={() => setShowCreate(true)}>Create your first event</button>}</div>
        )}
        </>}
      </section>
      {showCreate && product && <CreateEvent eventType={product.type} onClose={() => setShowCreate(false)} onCreated={(id) => navigate(`/events/${id}`)} />}
    </main>
  );
}

function CreateEvent({ eventType, onClose, onCreated }: { eventType: EventItem["type"]; onClose: () => void; onCreated: (id: string) => void }) {
  const [form, setForm] = useState({ title: "", type: eventType, startDate: "", endDate: "", location: "", description: "", voteUnitPrice: "" });
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
          <div className="event-product-selected"><span className={`event-dot ${eventType.toLowerCase()}`} />{eventLabels[eventType]} workspace</div>
          {form.type === "VOTING" && <label>Paid vote price per vote (GHS) <span className="muted">optional</span><input type="number" min="0.01" step="0.01" value={form.voteUnitPrice} onChange={(event) => setForm({ ...form, voteUnitPrice: event.target.value })} placeholder="Leave blank for free votes only" /></label>}
          <div className="form-row"><label>Starts<input type="date" required value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label>Ends<input type="date" required min={form.startDate} value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div>
          <label>Location<input required value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} placeholder="City, venue, or online" /></label>
          {error && <div className="alert alert-error">{error}</div>}
          <button className="button button-dark button-wide" disabled={busy}>{busy ? <CubeLoader label="Create" compact /> : <>Create event <span>↗</span></>}</button>
        </form>
      </section>
    </div>
  );
}
