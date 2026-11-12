import { formatDate, formatMoney } from "../api";
import type { AnalyticsData, EventData, WorkspaceData } from "./workspace-types";

interface WeddingEventWorkspaceProps {
  event: EventData;
  data: WorkspaceData;
  analytics: AnalyticsData | null;
  tab: string;
  onSelect: (tab: string) => void;
  children: React.ReactNode;
}

export function WeddingEventWorkspace({ event, data, analytics, tab, onSelect, children }: WeddingEventWorkspaceProps) {
  if (tab !== "overview") return children;

  const attending = data.guests.filter((guest) => guest.status === "ATTENDING").length;
  const pending = data.guests.filter((guest) => guest.status === "PENDING").length;
  const estimatedBudget = data.budget.reduce((total, item) => total + Number(item.estimatedCost), 0);
  const paidBudget = data.budget.reduce((total, item) => total + Number(item.actualCost ?? 0), 0);

  return (
    <div className="workspace-body event-product-overview wedding-overview">
      <div className="stat-grid event-stats">
        <div className="stat-card"><span className="stat-label">Guests attending</span><strong>{attending}</strong><small>{pending} responses still pending</small></div>
        <div className="stat-card"><span className="stat-label">Budget planned</span><strong className="stat-money">{formatMoney(estimatedBudget, event.currency)}</strong><small>{formatMoney(paidBudget, event.currency)} recorded as actual spend</small></div>
        <div className="stat-card"><span className="stat-label">Wedding vendors</span><strong>{data.vendors.length}</strong><small>{data.vendors.filter((vendor) => vendor.agreedCost).length} with agreed pricing</small></div>
        <div className="stat-card"><span className="stat-label">Registry gifts</span><strong>{data.registry.length}</strong><small>{data.registry.filter((item) => item.claimed).length} claimed</small></div>
      </div>
      <div className="two-column-panels">
        <section className="content-card">
          <div className="eyebrow">YOUR CELEBRATION</div><h2>Make room for the moment.</h2>
          <p className="muted">{event.description || "Bring together your guest list, thoughtful details, and celebration plans in one place."}</p>
          <div className="detail-list">
            <div><span>Celebration</span><strong>{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</strong></div>
            <div><span>Location</span><strong>{event.location}</strong></div>
            <div><span>Programme moments</span><strong>{data.sessions.length}</strong></div>
            <div><span>Guest check-ins</span><strong>{analytics?.checkedIn ?? 0}</strong></div>
          </div>
        </section>
        <section className="content-card">
          <div className="eyebrow">WEDDING PLANNING</div><h2>Keep every detail close.</h2>
          <div className="quick-links">
            <button onClick={() => onSelect("guests")}><span className="quick-icon sage" /><span><strong>Guest list & RSVPs</strong><small>Review responses and dietary needs</small></span><b>↗</b></button>
            <button onClick={() => onSelect("wedding")}><span className="quick-icon peach" /><span><strong>Budget, vendors & registry</strong><small>Coordinate the details that matter</small></span><b>↗</b></button>
            <button onClick={() => onSelect("programme")}><span className="quick-icon cream">01</span><span><strong>Celebration programme</strong><small>Shape the flow of your day</small></span><b>↗</b></button>
          </div>
        </section>
      </div>
    </div>
  );
}
