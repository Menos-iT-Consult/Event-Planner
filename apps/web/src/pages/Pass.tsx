import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api";

interface PassData {
  pass?: { name: string; eventTitle: string; status?: string; checkedInAt?: string | null; qrUrl: string };
  order?: { purchaserName: string; eventTitle: string };
  passes?: { id: string; checkedInAt: string | null; qrUrl: string | null }[];
}

export function Pass() {
  const { token = "" } = useParams();
  const [data, setData] = useState<PassData | null>(null);
  const [message, setMessage] = useState("Preparing your digital pass...");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    api<PassData>(`/api/public/passes/${token}`)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (reason instanceof ApiError && reason.status === 409 && attempt < 8) {
          setMessage("Payment received? We’re preparing your passes...");
          window.setTimeout(() => setAttempt((value) => value + 1), 2500);
        } else {
          setError(reason instanceof Error ? reason.message : "Could not load your pass");
        }
      });
    return () => { active = false; };
  }, [token, attempt]);

  return <main className="pass-shell"><nav className="public-nav"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span className="public-event-label">YOUR DIGITAL PASS</span></nav>
    <section className="pass-card">{error ? <><div className="pass-symbol">✳</div><div className="eyebrow">PASS NOT AVAILABLE</div><h1>We couldn’t open this pass.</h1><p className="muted">{error}</p><Link className="button button-outline" to="/">Back to EventFlow</Link></> : !data ? <><div className="pass-symbol">✿</div><h1>{message}</h1><p className="muted">Keep this page handy for the day.</p></> :
      data.pass ? <><div className="pass-symbol">✿</div><div className="eyebrow">YOU’RE ON THE LIST</div><h1>{data.pass.eventTitle}</h1><p>Welcome, {data.pass.name}.</p><div className="qr-frame"><img src={data.pass.qrUrl} alt="Your event QR pass" /></div><div className="pass-status">{data.pass.checkedInAt ? "Already checked in" : "Ready at the door"}</div><small>Show this QR code to event staff when you arrive.</small></> :
        <><div className="pass-symbol">✳</div><div className="eyebrow">YOUR TICKETS ARE READY</div><h1>{data.order?.eventTitle}</h1><p>For {data.order?.purchaserName}.</p><div className="ticket-pass-list">{data.passes?.map((pass, index) => <div className="ticket-pass" key={pass.id}><strong>Ticket {index + 1}</strong>{pass.qrUrl ? <img src={pass.qrUrl} alt={`Ticket ${index + 1} QR pass`} /> : <span>Pass image is being prepared.</span>}<small>{pass.checkedInAt ? "Already checked in" : "Ready at the door"}</small></div>)}</div><small>Present one QR code for each ticket at the entrance.</small></>}
    </section>
    <footer className="public-event-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span>Gather well. Remember more.</span></footer>
  </main>;
}

