import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { Dashboard } from "./pages/Dashboard";
import { EventWorkspace } from "./pages/EventWorkspace";
import { Login } from "./pages/Login";
import { PublicEvent } from "./pages/PublicEvent";
import { Rsvp } from "./pages/Rsvp";
import { Pass } from "./pages/Pass";
import { Scanner } from "./pages/Scanner";
import { PaymentReturn } from "./pages/PaymentReturn";
import { Signup } from "./pages/Signup";
import { ForgotPassword, ResetPassword, TwoFactorChallenge } from "./pages/AccountSecurity";
import { TwoFactorSetup } from "./pages/TwoFactorSetup";
import { AboutPage, ContactPage, EventsPage, HelpPage, PricingPage, PrivacyPage, PublicHeader, TermsPage } from "./pages/PublicPages";
import { CubeLoader } from "./components/CubeLoader";
import { SmsOptOut } from "./pages/SmsOptOut";
import { ProductLanding } from "./pages/ProductLanding";
import { eventProducts, getProductReturnPath } from "./products";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "EVENT_MANAGER" | "CHECK_IN_STAFF";
}

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(true);
  const location = useLocation();

  useEffect(() => {
    let active = true;
    api<{ user: User }>("/api/auth/me")
      .then(({ user: current }) => {
        if (active) setUser(current);
      })
      .catch(() => {
        if (active) setUser(null);
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [location.pathname]);

  if (checking && !location.pathname.startsWith("/rsvp/") &&
      !location.pathname.startsWith("/pass/") &&
      !location.pathname.startsWith("/passes/") &&
      !location.pathname.startsWith("/e/") &&
      !["/events", "/pricing", "/about", "/contact", "/help", "/privacy", "/terms", "/signup", "/weddings", "/voting", "/general-events", "/forgot-password", "/reset-password", "/two-factor", "/security/two-factor", "/sms-opt-out"].includes(location.pathname)) {
    return <main className="loading-screen"><CubeLoader label="EventFlow" /></main>;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to={getProductReturnPath(location.search)} replace /> : <Login onLogin={setUser} />} />
      <Route path="/signup" element={user ? <Navigate to={getProductReturnPath(location.search)} replace /> : <Signup onSignup={setUser} />} />
      <Route path="/forgot-password" element={user ? <Navigate to="/dashboard" replace /> : <ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/two-factor" element={user ? <Navigate to={getProductReturnPath(location.search)} replace /> : <TwoFactorChallenge onLogin={setUser} />} />
      <Route path="/security/two-factor" element={user ? <TwoFactorSetup /> : <Navigate to="/login" replace />} />
      <Route path="/sms-opt-out" element={<SmsOptOut />} />
      <Route path="/events" element={<EventsPage />} />
      <Route path="/pricing" element={<PricingPage />} />
      <Route path="/about" element={<AboutPage />} />
      <Route path="/contact" element={<ContactPage />} />
      <Route path="/help" element={<HelpPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/rsvp/:token" element={<Rsvp />} />
      <Route path="/pass/:token" element={<Pass />} />
      <Route path="/passes/:token" element={<Pass />} />
      <Route path="/payment/return" element={<PaymentReturn />} />
      <Route path="/e/:slug" element={<PublicEvent />} />
      <Route path="/scanner/:eventId" element={user ? <Scanner /> : <Navigate to="/login" replace />} />
      <Route
        path="/events/:eventId"
        element={user ? <EventWorkspace user={user} /> : <Navigate to="/login" replace />}
      />
      <Route path="/dashboard" element={user ? <Dashboard user={user} onLogout={() => setUser(null)} /> : <Navigate to="/login" replace />} />
      {eventProducts.map((product) => (
        <Route
          key={product.path}
          path={product.path}
          element={user
            ? <Dashboard user={user} onLogout={() => setUser(null)} eventType={product.type} />
            : <ProductLanding product={product} />}
        />
      ))}
      <Route path="/" element={<Home />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

function Home() {
  return (
    <main className="home-shell">
      <PublicHeader />
      <section className="hero">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" /> Everything in its moment</div>
          <h1>Make room for<br /><em>the meaningful.</em></h1>
          <p>One calm place to plan your celebration, bring people together, and make every detail feel effortless.</p>
          <Link className="button button-dark" to="/login">Open your workspace</Link>
          <div className="hero-proof"><span className="proof-avatars">M&nbsp; A&nbsp; K</span><span>Made for moments that matter</span></div>
        </div>
        <div className="hero-art" aria-label="Illustration of an event table with flowers">
          <div className="art-sun" />
          <div className="art-card art-card-back"><span>THE GARDEN</span><strong>Sunday<br />together</strong><small>Accra · 4:30 PM</small></div>
          <div className="art-stem stem-one" /><div className="art-stem stem-two" /><div className="art-stem stem-three" />
          <div className="art-flower flower-one">1</div><div className="art-flower flower-two">2</div><div className="art-flower flower-three">3</div>
          <div className="art-vase" />
          <div className="art-caption"><span>01 — 03</span><span>A little less logistics.<br />A lot more living.</span></div>
        </div>
      </section>
      <section className="feature-strip">
        <div><span className="feature-icon">01</span><strong>Every kind of gathering</strong><span>Weddings, contests, and the moments in between.</span></div>
        <div><span className="feature-icon">02</span><strong>Thoughtful by design</strong><span>Guests, schedules, tickets, and details in sync.</span></div>
        <div><span className="feature-icon">03</span><strong>People first, always</strong><span>More time for the things you’ll remember.</span></div>
      </section>
      <section className="home-information">
        <header><span className="eyebrow">THE COMPLETE EXPERIENCE</span><h2>From invitation to arrival.</h2></header>
        <div className="home-information-grid">
          <article><span>01</span><h3>Wedding planning</h3><p>Manage guests, RSVPs, dietary needs, plus-one allowances, budgets, vendors, registries, seating plans, and SMS updates.</p></article>
          <article><span>02</span><h3>Voting and contests</h3><p>Build categories, publish candidate profiles, accept free or paid votes, protect duplicate voting, and share live leaderboards.</p></article>
          <article><span>03</span><h3>Event operations</h3><p>Create ticket tiers, schedules, promos, waitlists, surveys, certificates, invoices, passes, scanner access, refunds, and recurring sessions.</p></article>
          <article><span>04</span><h3>Platform control</h3><p>Use administrator roles, audit history, notification templates, contact queues, password recovery, two-factor login, exports, and provider monitoring.</p></article>
        </div>
      </section>
      <footer className="home-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span>Gather well. Remember more.</span><span>© 2026 EventFlow</span></footer>
    </main>
  );
}

function NotFound() {
  return <main className="center-card"><span className="eyebrow">404 · A little detour</span><h1>This page isn't here.</h1><Link className="button button-dark" to="/">Back to EventFlow</Link></main>;
}
