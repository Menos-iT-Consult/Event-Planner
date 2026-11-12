import { formatDate, formatMoney } from "../api";
import type { AnalyticsData, EventData, WorkspaceData } from "./workspace-types";

interface VotingEventWorkspaceProps {
  event: EventData;
  data: WorkspaceData;
  analytics: AnalyticsData | null;
  tab: string;
  onSelect: (tab: string) => void;
  children: React.ReactNode;
}

export function VotingEventWorkspace({ event, data, analytics, tab, onSelect, children }: VotingEventWorkspaceProps) {
  if (tab !== "overview") return children;

  const candidates = data.categories.flatMap((category) =>
    category.candidates.map((candidate) => ({ ...candidate, category: category.name })),
  ).sort((left, right) => right.votesCount - left.votesCount);
  const voteCount = candidates.reduce((total, candidate) => total + candidate.votesCount, 0);
  const leadingVoteCount = candidates[0]?.votesCount ?? 0;

  return (
    <div className="workspace-body event-product-overview voting-overview">
      <div className="stat-grid event-stats">
        <div className="stat-card"><span className="stat-label">Contest categories</span><strong>{data.categories.length}</strong><small>Separate awards and divisions</small></div>
        <div className="stat-card"><span className="stat-label">Candidates</span><strong>{candidates.length}</strong><small>Profiles across all categories</small></div>
        <div className="stat-card"><span className="stat-label">Votes collected</span><strong>{voteCount}</strong><small>{analytics?.paidOrders ?? 0} paid vote orders</small></div>
        <div className="stat-card"><span className="stat-label">Vote revenue</span><strong className="stat-money">{formatMoney(analytics?.voteRevenue ?? "0", event.currency)}</strong><small>{analytics?.smsSent ?? 0} event messages sent</small></div>
      </div>
      <div className="two-column-panels">
        <section className="content-card">
          <div className="eyebrow">LIVE RESULTS</div><h2>Leaderboard</h2>
          {candidates.slice(0, 5).map((candidate, index) => (
            <article className="admin-list-item" key={candidate.id}>
              <strong>{String(index + 1).padStart(2, "0")} · {candidate.name}</strong>
              <small>{candidate.category} · {candidate.votesCount} {candidate.votesCount === 1 ? "vote" : "votes"}</small>
              <progress max={Math.max(leadingVoteCount, 1)} value={candidate.votesCount} aria-label={`${candidate.name}: ${candidate.votesCount} votes`} />
            </article>
          ))}
          {!candidates.length && <div className="empty-note">Add categories and candidates to start your leaderboard.</div>}
        </section>
        <section className="content-card">
          <div className="eyebrow">CONTEST SETUP</div><h2>Build the competition.</h2>
          <p className="muted">{event.description || "Organize award categories, candidate profiles, and a transparent live vote count."}</p>
          <div className="detail-list">
            <div><span>Voting opens</span><strong>{formatDate(event.startDate)}</strong></div>
            <div><span>Voting closes</span><strong>{formatDate(event.endDate)}</strong></div>
            <div><span>Event status</span><strong>{event.isPublished ? "Published" : "Draft"}</strong></div>
          </div>
          <div className="quick-links">
            <button onClick={() => onSelect("engage")}><span className="quick-icon peach" /><span><strong>Manage categories & candidates</strong><small>Set up profiles and vote options</small></span><b>↗</b></button>
            <button onClick={() => onSelect("updates")}><span className="quick-icon sage" /><span><strong>Send contest updates</strong><small>Keep voters informed</small></span><b>↗</b></button>
          </div>
        </section>
      </div>
    </div>
  );
}
