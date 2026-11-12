import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, formatDate } from "../api";
import { CubeLoader } from "../components/CubeLoader";
import "./PublicLayout.css";
import "./Events.css";
import "./Pricing.css";
import "./About.css";
import "./Contact.css";
import "./Privacy.css";
import "./Terms.css";

export function PublicHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <nav className={`public-nav${menuOpen ? " menu-open" : ""}`} aria-label="Main navigation">
      <Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link>
      <button
        className="mobile-menu-button"
        type="button"
        aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={menuOpen}
        aria-controls="public-navigation-links"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="menu-lines" aria-hidden="true"><i /><i /><i /></span>
        <span>{menuOpen ? "Close" : "Menu"}</span>
      </button>
      <div className="public-links" id="public-navigation-links" onClick={() => setMenuOpen(false)}>
        <Link to="/events">Events</Link>
        <Link to="/pricing">Pricing</Link>
        <Link to="/about">About</Link>
        <Link to="/contact">Contact</Link>
      </div>
      <div className="public-nav-actions" onClick={() => setMenuOpen(false)}>
        <Link className="button button-outline" to="/signup">Create account</Link>
        <Link className="button button-dark" to="/login">Sign in</Link>
      </div>
    </nav>
  );
}

export function PublicFooter() {
  return (
    <footer className="home-footer">
      <Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link>
      <div className="footer-links"><Link to="/help">Help</Link><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/contact">Contact</Link></div>
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
  const [locationFilter, setLocationFilter] = useState("");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);

  async function load(query = "") {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("search", query.trim());
      if (type) params.set("type", type);
      if (locationFilter.trim()) params.set("location", locationFilter.trim());
      if (from) params.set("from", `${from}T00:00:00.000Z`);
      params.set("page", String(page));
      const result = await api<{ events: PublicEventItem[]; pagination:{pageCount:number} }>(`/api/public/events${params.size ? `?${params}` : ""}`);
      setEvents(result.events);
      setPageCount(result.pagination.pageCount);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load events");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(search); }, [type, locationFilter, from, page]);

  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading"><span className="eyebrow">DISCOVER A GATHERING</span><h1>Events</h1><p>Browse public celebrations, competitions, conferences, and community moments.</p></header>
      <form className="directory-search" onSubmit={(event) => { event.preventDefault(); void load(search); }}>
        <input aria-label="Search events or locations" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search events or locations" />
        <select aria-label="Event type" value={type} onChange={(e) => setType(e.target.value)}><option value="">All event types</option><option value="WEDDING">Weddings</option><option value="VOTING">Voting and contests</option><option value="GENERAL">General events</option></select>
        <input aria-label="Location" value={locationFilter} onChange={(e) => setLocationFilter(e.target.value)} placeholder="Location" />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <button className="button button-dark">Search</button>
      </form>
      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {loading ? <div className="empty-panel"><CubeLoader label="Events" /></div> : events.length ? <div className="directory-grid">{events.map((item) => (
        <Link className="directory-card" to={`/e/${item.slug}`} key={item.id}>
          <div className={`event-card-art ${item.type.toLowerCase()}`}><span className="event-card-type">{item.type.replace("_", " ")}</span><span className="event-art-index">EVENTFLOW</span></div>
          <div className="directory-card-body"><h2>{item.title}</h2><p>{formatDate(item.startDate)}{item.startDate !== item.endDate ? ` — ${formatDate(item.endDate)}` : ""}</p><small>{item.location}</small>{item.description && <p>{item.description}</p>}</div>
        </Link>
      ))}</div> : <div className="empty-panel">No public events match your search.</div>}
      {pageCount > 1 && <div className="directory-pagination">
        <button className="button button-outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
        <span>Page {page} of {pageCount}</span>
        <button className="button button-outline" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
      </div>}
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
          ["Wedding", "Wedding daily rate", ["Guest lists and RSVPs", "Budget and vendor tracking", "Seating and digital passes"]],
          ["Voting and contests", "Voting daily rate", ["Categories and candidates", "Live leaderboards", "Paid votes and vote receipts"]],
          ["General events", "General event daily rate", ["Sessions and ticket tiers", "QR passes and check-in", "Sponsors, staff, and exports"]],
        ].map(([title, description, features]) => (
          <article className="pricing-card" key={String(title)}>
            <span className="card__border" aria-hidden="true" />
            <div className="card_title__container">
              <span className="eyebrow">EVENT TYPE</span>
              <h2 className="card_title">{String(title)}</h2>
              <p className="card_paragraph">{String(description)}</p>
            </div>
            <hr className="line" />
            <ul className="card__list">
              {(features as string[]).map((feature) => (
                <li className="card__list_item" key={feature}>
                  <span className="check" aria-hidden="true">
                    <svg className="check_svg" viewBox="0 0 16 16"><path d="M6.2 11.8 3.4 9l1.1-1.1 1.7 1.7 5.3-5.3L12.6 5.4 6.2 11.8Z" /></svg>
                  </span>
                  <span className="list_text">{feature}</span>
                </li>
              ))}
            </ul>
            <Link className="button pricing-card-button" to="/signup">
              <span className="blob1" aria-hidden="true" />
              <span className="inner">Create an event</span>
            </Link>
          </article>
        ))}
      </section>
      <section className="information-section">
        <div className="section-heading"><div><span className="eyebrow">WHAT THE TOTAL INCLUDES</span><h2>Calculated, not estimated</h2></div></div>
        <div className="feature-list-grid">
          <article><strong>Duration-based workspace</strong><p>Inclusive calendar days from the event start through the end date are multiplied by the configured daily rate.</p></article>
          <article><strong>Module access</strong><p>Guests, wedding budgets, voting categories, ticket tiers, schedules, staff access, QR passes, and notifications are included in the workspace.</p></article>
          <article><strong>Third-party charges</strong><p>SMS delivery, payment processing, object storage, databases, and hosting may carry separate provider fees.</p></article>
          <article><strong>Admin-controlled rates</strong><p>Administrators can update wedding, voting, and general-event daily rates for future event creation.</p></article>
        </div>
      </section>
      <p className="legal-note">Final pricing and payment terms are shown in your workspace and can be updated by platform administrators.</p>
      <PublicFooter />
    </main>
  );
}

export function AboutPage() {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading"><span className="eyebrow">ABOUT EVENTFLOW</span><h1>Thoughtful tools for meaningful gatherings.</h1><p>Plan celebrations, competitions, and professional events from the first invitation to the final check-in.</p></header>
      <section className="about-grid">
        <article><h2>Plan with clarity</h2><p>Bring guests, schedules, budgets, voting, tickets, certificates, surveys, promotions, and check-in into one connected workspace.</p></article>
        <article><h2>Welcome every guest</h2><p>Use public RSVP, registration, waitlist, survey, payment, and pass pages designed for mobile devices and fast responses.</p></article>
        <article><h2>Stay in control</h2><p>Administrators, event managers, and gate staff receive role-specific access, audit trails, and operational controls.</p></article>
      </section>
      <section className="information-section">
        <div className="section-heading"><div><span className="eyebrow">BUILT FOR EVERY KIND OF MOMENT</span><h2>One platform, specialised workflows</h2></div></div>
        <div className="feature-list-grid">
          <article><strong>Weddings</strong><p>Guest RSVPs, plus-one limits, dietary requirements, budgets, vendors, registries, table information, reminders, and digital passes.</p></article>
          <article><strong>Voting and contests</strong><p>Categories, candidates, paid and free votes, leaderboards, fraud controls, verification, promo codes, receipts, and live totals.</p></article>
          <article><strong>Corporate and general events</strong><p>Ticket tiers, capacity, seating, session schedules, speakers, sponsors, badges, certificates, surveys, and staff check-in.</p></article>
          <article><strong>Operations</strong><p>Analytics, exports, broadcasts, refunds, waitlists, recurring schedules, invoices, background jobs, provider health, and consent records.</p></article>
        </div>
      </section>
      <PublicFooter />
    </main>
  );
}

export function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.name.trim() || !form.email.trim() || form.message.trim().length < 10) {
      setError("Complete all fields with a message of at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await api("/api/public/contact", { method: "POST", body: JSON.stringify(form) });
      setSent(true);
      setForm({ name: "", email: "", message: "" });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not send your message");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="public-page-shell"><PublicHeader /><header className="content-page-heading"><span className="eyebrow">CONTACT EVENTFLOW</span><h1>How can we help?</h1></header>    <section className="contact-layout"><form className="stack-form" onSubmit={submit}><label>Your name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><label>Email address<input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label><label>Message<textarea required minLength={10} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></label>{error && <div className="alert alert-error" role="alert">{error}</div>}    {sent && <div className="alert alert-success" role="status">Your message was received by the EventFlow team.</div>}<button className="button button-dark" disabled={busy}>{busy ? <CubeLoader label="Send" compact /> : "Send message"}</button></form></section><PublicFooter /></main>  );
}

export function PrivacyPage() {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <article className="legal-page">
        <span className="eyebrow">LEGAL</span><h1>Privacy Policy</h1>
        <p>This platform-ready summary describes EventFlow data practices and must be reviewed by qualified legal counsel for the jurisdictions in which it operates.</p>
        <h2>Information collected</h2><p>EventFlow processes account details, names, contact information, event choices, RSVPs, dietary preferences, ticket purchases, vote records, check-in activity, consent records, payment references, support messages, and provider delivery status.</p>
        <h2>How information is used</h2><p>Data operates events, provides registration and pass services, processes valid votes and payments, sends requested notifications, generates reports, prevents fraud, handles support, and satisfies operational or legal obligations.</p>
        <h2>Storage and processors</h2><p>Hosting, database, object-storage, SMS, and payment providers process data only as needed to deliver EventFlow services. Operators must configure processor agreements and regional data-transfer controls.</p>
        <h2>Retention and deletion</h2><p>Event and account owners control operational retention. Data-deletion requests are recorded for review and fulfilled according to legal, financial, and audit obligations.</p>
        <h2>Your controls</h2><p>Eligible users may request access, correction, export, restriction, consent withdrawal, or deletion through the contact page. Identity verification is required before sensitive requests are fulfilled.</p>
        <h2>Security</h2><p>EventFlow uses password hashing, authentication cookies, role checks, rate limits, security headers, audit logs, signed payment webhooks, and private pass tokens. No system can guarantee absolute security.</p>
        <p className="legal-note">Before public launch, add jurisdiction-specific retention, minors, medical dietary, marketing, cookie, and payment-data requirements.</p>
      </article>
      <PublicFooter />
    </main>
  );
}

export function TermsPage() {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <article className="legal-page">
        <span className="eyebrow">LEGAL</span><h1>Terms of Service</h1>
        <p>These product-ready terms describe platform responsibilities and require jurisdiction-specific review before public launch.</p>
        <h2>Account responsibility</h2><p>Users must provide accurate information, protect credentials and authentication codes, use lawful event content, and maintain appropriate participant permissions.</p>
        <h2>Event responsibility</h2><p>Event owners are responsible for descriptions, prices, capacity, scheduling, refunds, accessibility, licences, attendee safety, communications, and consumer protections.</p>
        <h2>Payments and refunds</h2><p>Payment providers authorise transactions and may hold funds until payout. Event owners approve final cancellation, refund, and dispute handling under published policies.</p>
        <h2>Voting rules</h2><p>Contest owners must publish eligibility, voting windows, pricing, duplicate-vote rules, result treatment, and dispute procedures. EventFlow provides controls but does not guarantee contest legality or fairness.</p>
        <h2>Messaging</h2><p>Users must obtain valid consent, avoid unsolicited prohibited communication, include accurate sender information, and comply with marketing and SMS rules.</p>
        <h2>Availability and third parties</h2><p>The platform depends on databases, hosting, payment, SMS, QR, and object-storage providers. Maintenance, provider outages, and network conditions may affect service.</p>
        <h2>Acceptable use</h2><p>Prohibited activity includes unlawful events, fraud, payment abuse, unauthorised access, scraping, phishing, vote manipulation, malware, harassment, and interference with the service.</p>
        <p className="legal-note">Public launch should add governing law, dispute process, liability limits, indemnity, tax responsibility, termination rights, refund terms, and provider-specific contracts.</p>
      </article>
      <PublicFooter />
    </main>
  );
}

export function HelpPage() {
  return (
    <main className="public-page-shell">
      <PublicHeader />
      <header className="content-page-heading">
        <span className="eyebrow">HELP CENTER</span>
        <h1>Answers for every moment.</h1>
        <p>Start with common setup, payments, RSVP, voting, ticket, check-in, and account questions.</p>
      </header>
      <section className="feature-list-grid">
        <article><strong>Creating an event</strong><p>Choose a wedding, voting, or general-event type, add dates and location, then review the calculated daily cost.</p></article>
        <article><strong>Inviting guests</strong><p>Add names and phone numbers, set plus-one allowances, and send private RSVP links or digital passes.</p></article>
        <article><strong>Running a contest</strong><p>Create categories and candidates, configure ticket or vote prices, publish rules, and monitor results and payment status.</p></article>
        <article><strong>Checking in guests</strong><p>Open the staff scanner, grant it camera access, and scan each unique guest or ticket pass once.</p></article>
        <article><strong>Managing payments</strong><p>Verify Paystack callbacks, reconcile paid orders, review refunds, and monitor provider status before approving settlements.</p></article>
        <article><strong>Protecting an account</strong><p>Use a unique password, enable two-factor authentication, save backup codes, and review active login sessions.</p></article>
        <article><strong>Privacy requests</strong><p>Submit access, correction, export, consent withdrawal, or deletion requests from the contact page.</p></article>
        <article><strong>Accessibility</strong><p>Use keyboard navigation, visible focus states, readable text, reduced-motion preferences, and screen-reader labels throughout EventFlow.</p></article>
      </section>
      <PublicFooter />
    </main>
  );
}
