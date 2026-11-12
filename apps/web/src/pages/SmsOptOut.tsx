import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "../api";

export function SmsOptOut() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/api/public/features/sms-opt-out", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update your message preferences");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="rsvp-shell">
      <nav className="public-nav">
        <Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link>
        <span className="public-event-label">MESSAGE PREFERENCES</span>
      </nav>
      <section className="rsvp-card" aria-labelledby="sms-optout-title">
        <div className="eyebrow">YOUR PREFERENCES</div>
        <h1 id="sms-optout-title">{done ? "You’re opted out." : "Stop event updates?"}</h1>
        <p className="muted">
          {done
            ? "You will no longer receive non-essential SMS updates for this event."
            : "You can stop non-essential SMS updates for the event associated with this link."}
        </p>
        {!done && (
          <>
            {!token && <div className="alert alert-error" role="alert">This opt-out link is invalid or incomplete.</div>}
            {error && <div className="alert alert-error" role="alert">{error}</div>}
            <button className="button button-dark" type="button" disabled={!token || busy} onClick={() => void submit()}>
              {busy ? "Updating preferences..." : "Stop event SMS"}
            </button>
          </>
        )}
      </section>
      <footer className="public-event-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link></footer>
    </main>
  );
}
