import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatDate, formatMoney } from "../api";

interface PublicEventData {
  id: string;
  slug: string;
  title: string;
  type: string;
  startDate: string;
  endDate: string;
  location: string;
  description?: string | null;
  currency: string;
  voteUnitPrice?: string | null;
  categories: {
    id: string;
    name: string;
    candidates: { id: string; name: string; description?: string | null; photoUrl?: string | null; votesCount: number }[];
  }[];
  ticketTiers: { id: string; name: string; description?: string | null; price: string; quantity: number; sold: number }[];
  sessions: { id: string; title: string; description?: string | null; startsAt: string; endsAt: string; location?: string | null; speaker?: string | null }[];
  registry: { id: string; title: string; url?: string | null; price?: string | null }[];
}

export function PublicEvent() {
  const { slug = "" } = useParams();
  const [event, setEvent] = useState<PublicEventData | null>(null);
  const [error, setError] = useState("");
  const [contact, setContact] = useState("");
  const [voted, setVoted] = useState("");
  const [voteError, setVoteError] = useState("");
  const [paidVote, setPaidVote] = useState({ candidateId: "", email: "", phone: "", quantity: 1 });
  const [paidVoteError, setPaidVoteError] = useState("");
  const [payingForVotes, setPayingForVotes] = useState(false);
  const [checkout, setCheckout] = useState({ tierId: "", name: "", email: "", phone: "", quantity: 1 });
  const [checkoutError, setCheckoutError] = useState("");
  const [checkingOut, setCheckingOut] = useState(false);
  const [claimerName, setClaimerName] = useState("");
  const [claimedItems, setClaimedItems] = useState<string[]>([]);
  const [registryMessage, setRegistryMessage] = useState("");

  useEffect(() => {
    api<{ event: PublicEventData }>(`/api/public/events/${slug}`)
      .then(({ event: current }) => {
        setEvent(current);
        if (current.ticketTiers[0]) setCheckout((form) => ({ ...form, tierId: current.ticketTiers[0].id }));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This event could not be found"));
  }, [slug]);

  useEffect(() => {
    if (event?.type !== "VOTING") return;
    const refresh = () => {
      void api<{ categories: { id: string; candidates: { id: string; votesCount: number }[] }[] }>(
        `/api/public/events/${slug}/leaderboard`,
      ).then(({ categories }) => {
        setEvent((current) => current && ({
          ...current,
          categories: current.categories.map((category) => ({
            ...category,
            candidates: category.candidates.map((candidate) => {
              const refreshed = categories.find((item) => item.id === category.id)
                ?.candidates.find((item) => item.id === candidate.id);
              return refreshed ? { ...candidate, votesCount: refreshed.votesCount } : candidate;
            }),
          })),
        }));
      }).catch((reason: unknown) => {
        console.error("Could not refresh the voting leaderboard", reason);
      });
    };
    const timer = window.setInterval(refresh, 10000);
    return () => window.clearInterval(timer);
  }, [event?.type, slug]);

  async function vote(eventForm: FormEvent, candidateId: string) {
    eventForm.preventDefault(); setVoteError(""); setVoted("");
    try {
      await api(`/api/public/events/${slug}/votes`, {
        method: "POST",
        body: JSON.stringify({ candidateId, voterContact: contact }),
      });
      setVoted("Your vote has been recorded. Thank you for taking part.");
    } catch (reason) { setVoteError(reason instanceof Error ? reason.message : "Could not record your vote"); }
  }

  async function buyTickets(eventForm: FormEvent) {
    eventForm.preventDefault(); setCheckoutError(""); setCheckingOut(true);
    try {
      const result = await api<{ authorizationUrl: string; orderAccessUrl: string }>(`/api/public/events/${slug}/checkout`, {
        method: "POST",
        body: JSON.stringify({
          ticketTierId: checkout.tierId,
          quantity: Number(checkout.quantity),
          purchaserName: checkout.name,
          purchaserEmail: checkout.email,
          purchaserPhone: checkout.phone,
        }),
      });
      sessionStorage.setItem("eventflow_order_access", result.orderAccessUrl);
      window.location.assign(result.authorizationUrl);
    } catch (reason) {
      setCheckoutError(reason instanceof Error ? reason.message : "Could not start checkout");
      setCheckingOut(false);
    }
  }

  async function buyVotes(eventForm: FormEvent, candidateId: string) {
    eventForm.preventDefault(); setPaidVoteError(""); setPayingForVotes(true);
    try {
      const result = await api<{ authorizationUrl: string }>(`/api/public/events/${slug}/vote-checkout`, {
        method: "POST",
        body: JSON.stringify({
          candidateId,
          quantity: Number(paidVote.quantity),
          email: paidVote.email,
          phone: paidVote.phone,
        }),
      });
      window.location.assign(result.authorizationUrl);
    } catch (reason) {
      setPaidVoteError(reason instanceof Error ? reason.message : "Could not start vote payment");
      setPayingForVotes(false);
    }
  }

  async function claimGift(itemId: string) {
    setRegistryMessage("");
    try {
      await api(`/api/public/registry/${itemId}/claim`, {
        method: "POST",
        body: JSON.stringify({ name: claimerName }),
      });
      setClaimedItems((items) => [...items, itemId]);
    } catch (reason) {
      setRegistryMessage(reason instanceof Error ? reason.message : "Could not claim this gift");
    }
  }

  if (error) return <main className="public-error"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><div className="center-card"><span className="eyebrow">THIS GATHERING ISN’T HERE</span><h1>{error}</h1><Link to="/" className="button button-dark">Go to EventFlow</Link></div></main>;
  if (!event) return <main className="loading-screen">A lovely moment is on its way...</main>;

  return (
    <main className="public-event-shell">
      <nav className="public-nav public-event-nav"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span className="public-event-label">A GATHERING TO REMEMBER</span></nav>
      <header className={`public-event-hero ${event.type.toLowerCase()}`}>
        <div className="public-event-orb">{event.type === "WEDDING" ? "✿" : event.type === "VOTING" ? "✳" : "◈"}</div>
        <div className="eyebrow">{event.type.replace("_", " ")} · YOU’RE INVITED</div>
        <h1>{event.title}</h1>
        {event.description && <p>{event.description}</p>}
        <div className="public-event-meta"><span>◷ &nbsp;{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</span><span>⌖ &nbsp;{event.location}</span></div>
      </header>
      <div className="public-event-content">
        {event.type === "VOTING" && <section className="public-section">
          <div className="eyebrow">YOUR VOICE MATTERS</div><h2>Meet the nominees</h2><p className="muted">Choose a nominee and cast one vote in each category.</p>
          <label className="voter-contact">Your phone or email<input required value={contact} onChange={(e) => setContact(e.target.value)} placeholder="+233 24 000 0000 or you@example.com" /></label>
          {event.voteUnitPrice && <div className="paid-vote-panel"><div className="eyebrow">SUPPORT YOUR FAVORITE</div><p>Paid votes are {formatMoney(event.voteUnitPrice, event.currency)} each.</p><div className="form-row"><label>Email for secure checkout<input type="email" required value={paidVote.email} onChange={(e) => setPaidVote({ ...paidVote, email: e.target.value })} /></label><label>Phone for vote receipt<input type="tel" required value={paidVote.phone} onChange={(e) => setPaidVote({ ...paidVote, phone: e.target.value })} /></label></div><label className="paid-quantity">Number of votes<input type="number" min="1" max="100" value={paidVote.quantity} onChange={(e) => setPaidVote({ ...paidVote, quantity: Number(e.target.value) })} /></label>{paidVoteError && <div className="alert alert-error">{paidVoteError}</div>}</div>}
          {voted && <div className="alert alert-success">{voted}</div>}{voteError && <div className="alert alert-error">{voteError}</div>}
          {event.categories.map((category) => <div className="public-category" key={category.id}><div className="eyebrow">CATEGORY</div><h3>{category.name}</h3><div className="candidate-grid">{category.candidates.map((candidate) => <article className="candidate-card" key={candidate.id}>{candidate.photoUrl ? <img src={candidate.photoUrl} alt="" /> : <div className="candidate-placeholder">✳</div>}<div><h4>{candidate.name}</h4><p>{candidate.votesCount} {candidate.votesCount === 1 ? "vote" : "votes"}</p>{candidate.description && <p>{candidate.description}</p>}<form onSubmit={(e) => void vote(e, candidate.id)}><button className="button button-outline" disabled={!contact.trim()}>Cast one free vote <span>↗</span></button></form>{event.voteUnitPrice && <form className="paid-vote-action" onSubmit={(e) => void buyVotes(e, candidate.id)}><button className="button button-dark" disabled={payingForVotes || !paidVote.email || !paidVote.phone}>Buy {paidVote.quantity} vote{paidVote.quantity === 1 ? "" : "s"} · {formatMoney(Number(event.voteUnitPrice) * paidVote.quantity, event.currency)} <span>↗</span></button></form>}</div></article>)}</div></div>)}
        </section>}
        {event.sessions.length > 0 && <section className="public-section"><div className="eyebrow">ON THE DAY</div><h2>The programme</h2><div className="public-session-list">{event.sessions.map((session) => <div className="public-session" key={session.id}><span>{new Intl.DateTimeFormat(undefined, { timeStyle: "short" }).format(new Date(session.startsAt))}</span><div><strong>{session.title}</strong><small>{session.location || event.location}{session.speaker ? ` · ${session.speaker}` : ""}</small></div></div>)}</div></section>}
        {event.ticketTiers.length > 0 && <section className="public-section ticket-section"><div className="eyebrow">SAVE YOUR PLACE</div><h2>Come be part of it.</h2><div className="public-ticket-grid">{event.ticketTiers.map((tier) => <div className="public-ticket" key={tier.id}><span className="eyebrow">{tier.name.toUpperCase()}</span><strong>{formatMoney(tier.price, event.currency)}</strong><small>{Math.max(0, tier.quantity - tier.sold)} places remaining</small>{tier.description && <p>{tier.description}</p>}</div>)}</div><form className="checkout-form" onSubmit={(e) => void buyTickets(e)}><label>Ticket type<select required value={checkout.tierId} onChange={(e) => setCheckout({ ...checkout, tierId: e.target.value })}>{event.ticketTiers.map((tier) => <option value={tier.id} key={tier.id}>{tier.name} · {formatMoney(tier.price, event.currency)}</option>)}</select></label><div className="form-row"><label>Your name<input required value={checkout.name} onChange={(e) => setCheckout({ ...checkout, name: e.target.value })} /></label><label>Email<input type="email" required value={checkout.email} onChange={(e) => setCheckout({ ...checkout, email: e.target.value })} /></label></div><div className="form-row"><label>Phone<input required type="tel" value={checkout.phone} onChange={(e) => setCheckout({ ...checkout, phone: e.target.value })} /></label><label>Number of tickets<input type="number" min="1" max="10" required value={checkout.quantity} onChange={(e) => setCheckout({ ...checkout, quantity: Number(e.target.value) })} /></label></div>{checkoutError && <div className="alert alert-error">{checkoutError}</div>}<button className="button button-dark" disabled={checkingOut}>{checkingOut ? "Opening secure checkout..." : "Continue to secure checkout"} <span>↗</span></button><small className="muted">Secure payments by Paystack. QR passes arrive by SMS after confirmation.</small></form></section>}
        {event.registry.length > 0 && <section className="public-section"><div className="eyebrow">A THOUGHTFUL LITTLE EXTRA</div><h2>Gift registry</h2><label className="voter-contact">Your name to reserve a gift<input required value={claimerName} onChange={(e) => setClaimerName(e.target.value)} placeholder="Your name" /></label>{registryMessage && <div className="alert alert-error">{registryMessage}</div>}<div className="registry-links">{event.registry.map((item) => <div className="registry-item" key={item.id}><span>{item.url ? <a href={item.url} target="_blank" rel="noreferrer">{item.title} ↗</a> : item.title}<small>{item.price ? formatMoney(item.price, event.currency) : "A little something lovely"}</small></span><button className="button button-outline" disabled={!claimerName.trim() || claimedItems.includes(item.id)} onClick={() => void claimGift(item.id)}>{claimedItems.includes(item.id) ? "Reserved ✓" : "I’ll bring this"}</button></div>)}</div></section>}
      </div>
      <footer className="public-event-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span>Gather well. Remember more.</span></footer>
    </main>
  );
}
