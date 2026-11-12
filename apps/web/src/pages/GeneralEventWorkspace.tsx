import { formatDate, formatMoney } from "../api";
import type { AnalyticsData, EventData, WorkspaceData } from "./workspace-types";

interface GeneralEventWorkspaceProps {
  event: EventData;
  data: WorkspaceData;
  analytics: AnalyticsData | null;
  tab: string;
  onSelect: (tab: string) => void;
  children: React.ReactNode;
}

export function GeneralEventWorkspace({ event, data, analytics, tab, onSelect, children }: GeneralEventWorkspaceProps) {
  if (tab !== "overview") return children;

  const soldTickets = data.tiers.reduce((total, tier) => total + tier.sold, 0);
  const checkInRate = analytics?.guests ? Math.round((analytics.checkedIn / analytics.guests) * 100) : 0;

  return (
    <div className="workspace-body event-product-overview general-event-overview">
      <div className="stat-grid event-stats">
        <div className="stat-card"><span className="stat-label">Registrations</span><strong>{data.guests.length}</strong><small>{analytics?.paidOrders ?? 0} paid ticket orders</small></div>
        <div className="stat-card"><span className="stat-label">Tickets claimed</span><strong>{soldTickets}</strong><small>{data.tiers.length} ticket {data.tiers.length === 1 ? "tier" : "tiers"} configured</small></div>
        <div className="stat-card"><span className="stat-label">Gate check-in</span><strong>{checkInRate}%</strong><small>{analytics?.checkedIn ?? 0} guests checked in</small></div>
        <div className="stat-card"><span className="stat-label">Ticket revenue</span><strong className="stat-money">{formatMoney(analytics?.ticketRevenue ?? "0", event.currency)}</strong><small>{data.sessions.length} programme sessions</small></div>
      </div>
      <div className="two-column-panels">
        <section className="content-card">
          <div className="eyebrow">EVENT OPERATIONS</div><h2>Ready for a smooth arrival.</h2>
          <p className="muted">{event.description || "Manage registration, ticket tiers, the programme, and on-the-day check-in from one event space."}</p>
          <div className="detail-list">
            <div><span>Event dates</span><strong>{formatDate(event.startDate)}{event.startDate !== event.endDate ? ` — ${formatDate(event.endDate)}` : ""}</strong></div>
            <div><span>Venue</span><strong>{event.location}</strong></div>
            <div><span>Tickets available</span><strong>{data.tiers.reduce((total, tier) => total + Math.max(tier.quantity - tier.sold, 0), 0)}</strong></div>
          </div>
        </section>
        <section className="content-card">
          <div className="eyebrow">PLAN & DELIVER</div><h2>Everything in its place.</h2>
          <div className="quick-links">
            <button onClick={() => onSelect("tickets")}><span className="quick-icon peach">01</span><span><strong>Ticket tiers & passes</strong><small>Configure admission and pricing</small></span><b>↗</b></button>
            <button onClick={() => onSelect("programme")}><span className="quick-icon sage">02</span><span><strong>Programme & sessions</strong><small>Publish the schedule</small></span><b>↗</b></button>
            <button onClick={() => onSelect("guests")}><span className="quick-icon cream">03</span><span><strong>Registration & check-in</strong><small>See your attendee list</small></span><b>↗</b></button>
          </div>
        </section>
      </div>
    </div>
  );
}
