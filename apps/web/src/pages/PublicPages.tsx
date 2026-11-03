import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";

export function PublicHeader() {
  return (
    <nav className="public-nav">
      <Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link>
      <div className="public-links">
        <Link to="/events">Events</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/about">About</Link>
        <Link to="/contact">Contact</Link>
      </div>
      <Link className="button button-outline" to="/login">Sign in</Link>
    </nav>
  );
}

export function PublicFooter() {
  return (
    <footer className="home-footer">
      <Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link>
      <div className="footer-links"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/contact">Contact</Link></div>
      <span>2026 EventFlow</span>
    </footer>
  );
}

interface PublicEventItem {
  id: string;
  slug: string;
  title: string;
  type: string;
  startDate: string;
  endDate: string;
  location: string;
  description?: string | null;
  currency: string;
}

export function EventsPage() {
  const [events, setEvents] = useState<PublicEventItem[]>([]);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  async function load(query = "") {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (type) params.set("type", type);
      const result = await api<{ events: PublicEventItem[] }>(`/api/public/events${params.size ? `?${params}` : ""}`);
      setEvents(result.events);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [type]);

  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading"><span className="eyebrow">DISCOVER A GATHERING</span><h1>Events</h1><p>Browse public celebrations, competitions, conferences, and community moments.</p></header>
      <form className="directory-search" onSubmit={(event) => { event.preventDefault(); void load(search); }}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events or locations" />
        <select value={type} onChange={(e) => setType(e.target.value)}><option value="">All event types</option><option value="WEDDING">Weddings</option><option value="VOTING">Voting and contests</option><option value="GENERAL">General events</option></select>
        <button className="button button-dark">Search</button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}
      {loading ? <div className="empty-panel">Loading events...</div> : events.length ? <div className="directory-grid">{events.map((item) => (
        <Link className="directory-card" to={`/e/${item.slug}`} key={item.id}>
          <div className={`event-card-art ${item.type.toLowerCase()}`}><span className="event-card-type">{item.type.replace("_", " ")}</span><span className="event-art-index">EVENTFLOW</span></div>
          <div className="directory-card-body"><h2>{item.title}</h2><p>{formatDate(item.startDate)}{item.startDate !== item.endDate ? ` — ${formatDate(item.endDate)}` : ""}</p><small>{item.location}</small>{item.description && <p>{item.description}</p>}</div>
        </Link>
      ))}</div> : <div className="empty-panel">No public events match your search.</div>}
      <PublicFooter />
    </main>
  );
}

export function PricingPage() {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading"><span className="eyebrow">SIMPLE EVENT COSTS</span><h1>Pricing</h1><p>EventFlow calculates duration-based planning costs for each event.</p></header>
      <section className="pricing-grid">
        {[
          ["Wedding", "Wedding daily rate"],
          ["Voting and contests", "Voting daily rate"],
          ["General events", "General event daily rate"],
        ].map(([title, description]) => (
          <article className="pricing-card" key={title}><span className="eyebrow">EVENT TYPE</span><h2>{title}</h2><p>{description}</p><ul><li>Inclusive calendar-day pricing</li><li>Guest and event management</li><li>Digital passes and messaging</li></ul></article>
        ))}
      </section>
      <p className="legal-note">Final pricing and payment terms are shown in your workspace and can be updated by platform administrators.</p>
      <PublicFooter />
    </main>
  );
}

export function AboutPage() {
  return (
    <main className="public-page-shell"><PublicHeader /><header className="content-page-heading"><span className="eyebrow">ABOUT EVENTFLOW</span><h1>Thoughtful tools for meaningful gatherings.</h1></header><section className="about-grid"><article><h2>Plan with clarity</h2><p>Bring guests, schedules, budgets, voting, tickets, and check-in into one connected workspace.</p></article><article><h2>Welcome every guest</h2><p>Use public RSVP and registration pages designed for mobile devices and fast responses.</p></article><article><h2>Stay in control</h2><p>Role-based access keeps administrators, event managers, and gate staff focused on the right tasks.</p></article></section><PublicFooter /></main>
  );
}

export function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || form.message.trim().length < 10) {
      setError("Complete all fields with a message of at least 10 characters.");
      return;
    }
    setSent(true);
  }

  return (
    <main className="public-page-shell"><PublicHeader /><header className="content-page-heading"><span className="eyebrow">CONTACT EVENTFLOW</span><h1>How can we help?</h1></header><section className="contact-layout"><form className="stack-form" onSubmit={submit}><label>Your name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Message<textarea required minLength={10} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>{error && <div className="alert alert-error">{error}</div>}{sent && <div className="alert alert-success">Your message has been prepared. Production contact delivery must be connected before submissions are sent to a support team.</div>}<button className="button button-dark">Prepare message</button></form></section><PublicFooter /></main>
  );
}

export function PrivacyPage() {
  return (
    <main className="public-page-shell"><PublicHeader /><article className="legal-page"><span className="eyebrow">LEGAL</span><h1>Privacy Policy</h1><p>This privacy policy requires production review and replacement before public launch.</p><h2>Information collected</h2><p>EventFlow may process account, event, guest, registration, ticket, payment, and messaging information needed to operate the platform.</p><h2>Data controls</h2><p>Providers and administrators are responsible for configuring retention, access, deletion, consent, and regional compliance requirements.</p></article><PublicFooter /></main>
  );
}

export function TermsPage() {
  return (
    <main className="public-page-shell"><PublicHeader /><article className="legal-page"><span className="eyebrow">LEGAL</span><h1>Terms of Service</h1><p>These terms require production review and replacement before public launch.</p><h2>Use of EventFlow</h2><p>Accounts and events must be created and operated lawfully. Users are responsible for content, invitations, payments, and attendee communications.</p><h2>Service availability</h2><p>Third-party services, payment providers, messaging providers, storage, and database availability may affect platform operations.</p></article><PublicFooter /></main>
  );
}
