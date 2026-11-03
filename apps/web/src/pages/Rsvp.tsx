import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api, formatDate } from "../api";

interface Invitation {
  name: string;
  plusOnesAllowed: number;
  status: string;
  dietary?: string | null;
  event: { title: string; startDate: string; endDate: string; location: string };
}

export function Rsvp() {
  const { token = "" } = useParams();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [passUrl, setPassUrl] = useState("");
  const [status, setStatus] = useState("ATTENDING");
  const [plusOnes, setPlusOnes] = useState(0);
  const [dietary, setDietary] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ invitation: Invitation }>(`/api/public/rsvp/${token}`)
      .then(({ invitation: current }) => {
        setInvitation(current);
        setStatus(current.status === "DECLINED" ? "DECLINED" : "ATTENDING");
        setDietary(current.dietary ?? "");
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "This RSVP link could not be found"));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setMessage(""); setBusy(true);
    try {
      const result = await api<{ guest: { status: string }; passUrl: string | null; smsStatus: string; passError?: string }>(`/api/public/rsvp/${token}`, {
        method: "POST",
        body: JSON.stringify({ status, plusOnes: Number(plusOnes), dietary: dietary || undefined }),
      });
      setPassUrl(result.passUrl ?? "");
      setError(result.passError ?? (result.smsStatus === "FAILED" ? "Your response was saved, but we could not send the SMS receipt." : ""));
      setMessage(result.guest.status === "ATTENDING" ? "You’re on the list. We can’t wait to celebrate with you." : "Your response has been noted. Thank you for letting us know.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not submit your response"); }
    finally { setBusy(false); }
  }

  return <main className="rsvp-shell"><nav className="public-nav"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span className="public-event-label">A PERSONAL INVITATION</span></nav>
    {!invitation ? <div className="rsvp-card"><div className="eyebrow">YOU’RE INVITED</div>{error ? <><h1>We couldn’t find this invitation.</h1><p className="muted">{error}</p></> : <h1>Opening your invitation...</h1>}</div> :
      <div className="rsvp-card"><div className="rsvp-flower">✿</div><div className="eyebrow">A LITTLE NOTE FOR YOU</div><h1>You’re invited, {invitation.name}.</h1><h2>{invitation.event.title}</h2><p>{formatDate(invitation.event.startDate)}{invitation.event.startDate !== invitation.event.endDate ? ` — ${formatDate(invitation.event.endDate)}` : ""}<br />{invitation.event.location}</p>
        {message ? <div className="rsvp-confirmation"><span>♡</span><h3>{message}</h3>{error && <div className="alert alert-error">{error}</div>}{passUrl && <a className="button button-dark" href={passUrl}>Open your digital pass ↗</a>}<small>We’ll send a confirmation by SMS.</small></div> :
          <form className="stack-form rsvp-form" onSubmit={submit}><label>Your response<select value={status} onChange={(e) => setStatus(e.target.value)}><option value="ATTENDING">Joyfully accepts</option><option value="DECLINED">Regretfully declines</option></select></label>{status === "ATTENDING" && <><label>Number of plus-ones<input type="number" min="0" max={invitation.plusOnesAllowed} value={plusOnes} onChange={(e) => setPlusOnes(Number(e.target.value))} /><small className="muted">Your invitation includes up to {invitation.plusOnesAllowed} plus-one(s).</small></label><label>Dietary needs<textarea rows={3} maxLength={500} value={dietary} onChange={(e) => setDietary(e.target.value)} placeholder="Anything we can prepare for you?" /></label></>}{error && <div className="alert alert-error">{error}</div>}<button className="button button-dark button-wide" disabled={busy}>{busy ? "Sending your response..." : "Send my RSVP"} <span>↗</span></button></form>}
      </div>}
    <footer className="public-event-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span>Made for moments that matter.</span></footer>
  </main>;
}
