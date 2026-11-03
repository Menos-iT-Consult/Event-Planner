import { Link } from "react-router-dom";

export function PaymentReturn() {
  const accessUrl = sessionStorage.getItem("eventflow_order_access");
  const passPath = accessUrl ? new URL(accessUrl, window.location.origin).pathname : null;
  return <main className="rsvp-shell"><nav className="public-nav"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span className="public-event-label">PAYMENT UPDATE</span></nav><section className="rsvp-card payment-return-card"><div className="rsvp-flower">✳</div><div className="eyebrow">THANK YOU</div><h1>Your checkout is complete.</h1><p>We’re confirming your payment and preparing your digital passes. We’ll send the pass links by SMS too.</p>{passPath && <Link className="button button-dark" to={passPath}>View your passes ↗</Link>}<small>It can take a moment for the payment confirmation to arrive.</small></section><footer className="public-event-footer"><Link className="brand" to="/"><span className="brand-mark">e</span> eventflow</Link><span>Gather well. Remember more.</span></footer></main>;
}

