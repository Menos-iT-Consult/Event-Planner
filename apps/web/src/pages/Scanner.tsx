import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Link, useParams } from "react-router-dom";
import { ApiError, api } from "../api";

interface ScanResult {
  checkedIn: boolean;
  attendee: string;
}

export function Scanner() {
  const { eventId = "" } = useParams();
  const scanInProgress = useRef(false);
  const [cameraError, setCameraError] = useState("");
  const [token, setToken] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [cameraStarted, setCameraStarted] = useState(false);

  async function checkIn(scanned: string) {
    if (scanInProgress.current) return;
    const clean = scanned.trim();
    let tokenValue = clean;
    if (/^https?:\/\//i.test(clean)) {
      try {
        tokenValue = new URL(clean).pathname.split("/").filter(Boolean).at(-1) ?? "";
      } catch {
        setError("The QR code does not contain a valid pass link.");
        return;
      }
    }
    if (!tokenValue) {
      setError("The QR code does not contain a valid pass.");
      return;
    }
    scanInProgress.current = true;
    setBusy(true); setError(""); setResult("");
    try {
      let checked: ScanResult;
      try {
        checked = await api<ScanResult>(`/api/events/${eventId}/check-in`, { method: "POST", body: JSON.stringify({ kind: "guest", token: tokenValue }) });
      } catch (reason) {
        if (!(reason instanceof ApiError) || reason.status !== 404) throw reason;
        checked = await api<ScanResult>(`/api/events/${eventId}/check-in`, { method: "POST", body: JSON.stringify({ kind: "ticket", token: tokenValue }) });
      }
      setResult(`${checked.attendee} is checked in. Welcome!`);
      setToken("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not check in this pass");
    } finally { scanInProgress.current = false; setBusy(false); }
  }

  useEffect(() => {
    const scanner = new Html5Qrcode("eventflow-qr-scanner");
    let disposed = false;
    Html5Qrcode.getCameras()
      .then((cameras) => {
        if (!cameras.length) {
          setCameraError("No camera is available. You can enter the pass code below.");
          return;
        }
        return scanner.start(
          cameras[0].id,
          { fps: 10, qrbox: { width: 240, height: 240 } },
          (decoded) => { if (!busy) void checkIn(decoded); },
          () => undefined,
        ).then(() => {
          if (disposed) {
            return scanner.stop().then(() => scanner.clear());
          }
          setCameraStarted(true);
        });
      })
      .catch((reason: unknown) => {
        if (!disposed) {
          setCameraError(reason instanceof Error ? reason.message : "Camera access is unavailable");
        }
      });
    return () => {
      disposed = true;
      if (scanner.isScanning) {
        void scanner.stop().then(() => scanner.clear()).catch((reason: unknown) => {
          console.error("Could not stop the QR scanner cleanly", reason);
        });
      } else {
        scanner.clear();
      }
    };
  }, [eventId]);

  return <main className="scanner-shell"><nav className="public-nav"><Link className="brand" to="/dashboard"><span className="brand-mark">e</span> eventflow</Link><Link className="button button-outline" to={`/events/${eventId}`}>Event workspace</Link></nav><section className="scanner-card"><div className="eyebrow">EVENT STAFF · GATE CHECK-IN</div><h1>Welcome them in.</h1><p className="muted">Point the camera at a guest or ticket pass QR code.</p><div id="eventflow-qr-scanner" className={`camera-frame ${cameraStarted ? "camera-ready" : ""}`} /><div className="camera-hint">{cameraError || (cameraStarted ? "Camera is ready · QR pass scans automatically" : "Starting camera...")}</div><div className="scanner-divider"><span>OR ENTER A PASS LINK</span></div><form className="scanner-manual" onSubmit={(event) => { event.preventDefault(); void checkIn(token); }}><input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste a pass code or URL" aria-label="Pass code or URL" /><button className="button button-dark" disabled={busy || !token.trim()}>{busy ? "Checking..." : "Check in"}</button></form>{error && <div className="alert alert-error" role="alert">{error}</div>}{result && <div className="scan-success"><span>✓</span><strong>{result}</strong><small>Ready for the next arrival.</small></div>}</section><footer className="public-event-footer"><span>EventFlow gate scanner</span><span>One scan. One welcome.</span></footer></main>;
}
