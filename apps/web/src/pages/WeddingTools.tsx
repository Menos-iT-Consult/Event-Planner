import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { api, formatDate } from "../api";

type WeddingDay = {
  id: string;
  name: string;
  date: string;
  location: string | null;
  isPublic: boolean;
  sortOrder: number;
};

type WeddingTask = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  status: "TODO" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  priority: number;
  dueAt: string | null;
  assigneeId: string | null;
};

type WeddingProfile = {
  headline: string;
  welcomeMessage: string;
  story: string;
  dressCode: string;
  travelInfo: string;
  invitationMessage: string;
  showStory: boolean;
  showDressCode: boolean;
  showTravelInfo: boolean;
  showSchedule: boolean;
  showRegistry: boolean;
  rsvpEnabled: boolean;
  showRsvpDeadline: boolean;
  rsvpDeadline: string;
  faq: Array<{ question: string; answer: string }>;
};

const blankProfile: WeddingProfile = {
  headline: "",
  welcomeMessage: "",
  story: "",
  dressCode: "",
  travelInfo: "",
  invitationMessage: "",
  showStory: true,
  showDressCode: true,
  showTravelInfo: true,
  showSchedule: true,
  showRegistry: true,
  rsvpEnabled: true,
  showRsvpDeadline: true,
  rsvpDeadline: "",
  faq: [],
};

function toLocalDateTime(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function WeddingChecklistPanel({ eventId }: { eventId: string }) {
  const [tasks, setTasks] = useState<WeddingTask[]>([]);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("PLANNING");
  const [dueAt, setDueAt] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const result = await api<{ tasks: WeddingTask[] }>(`/api/events/${eventId}/wedding/checklist`);
      setTasks(result.tasks);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load wedding checklist");
    }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function addTask(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/checklist`, {
        method: "POST",
        body: JSON.stringify({
          title,
          category,
          dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        }),
      });
      setTitle("");
      setDueAt("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add checklist task");
    }
  }

  async function toggleTask(task: WeddingTask) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/checklist/${task.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: task.status === "DONE" ? "TODO" : "DONE" }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update checklist task");
    }
  }

  async function deleteTask(taskId: string) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/checklist/${taskId}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove checklist task");
    }
  }

  const completed = tasks.filter((task) => task.status === "DONE").length;
  const overdue = tasks.filter((task) =>
    task.status !== "DONE" && task.dueAt && new Date(task.dueAt) < new Date(),
  ).length;

  return <div className="workspace-body">
    <div className="section-heading">
      <div><div className="eyebrow">ONE THING AT A TIME</div><h2>Wedding checklist</h2></div>
      <span className="item-count">{completed} / {tasks.length} complete</span>
    </div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {overdue > 0 && <div className="alert alert-error" role="status">{overdue} {overdue === 1 ? "task is" : "tasks are"} past due.</div>}
    <div className="two-column-panels">
      <form className="content-card stack-form compact-form" onSubmit={(event) => void addTask(event)}>
        <div className="eyebrow">ADD A MILESTONE</div><h3>Keep the next step clear</h3>
        <label>Task<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Confirm your photographer" /></label>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}>
          {["PLANNING", "VENUE", "VENDORS", "GUESTS", "BUDGET", "SCHEDULE", "OTHER"].map((item) => <option key={item}>{item}</option>)}
        </select></label>
        <label>Due date<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
        <button className="button button-dark">Add checklist task</button>
      </form>
      <section className="content-card">
        <div className="eyebrow">YOUR PLAN</div><h3>{tasks.length ? "A little progress adds up." : "Start with a few milestones."}</h3>
        {tasks.length ? <div className="admin-directory-list">{tasks.map((task) => <article className="admin-list-item" key={task.id}>
          <label className="checkbox-label">
            <input type="checkbox" checked={task.status === "DONE"} onChange={() => void toggleTask(task)} />
            <span><strong>{task.title}</strong><small>{task.category.toLowerCase()} {task.dueAt ? `· Due ${formatDate(task.dueAt)}` : ""}</small></span>
          </label>
          <button className="text-button" onClick={() => void deleteTask(task.id)} aria-label={`Remove ${task.title}`}>Remove</button>
        </article>)}</div> : <div className="empty-note">A starter checklist is created with each wedding. Add your own milestones here.</div>}
      </section>
    </div>
  </div>;
}

type SeatingPlan = {
  id: string;
  name: string;
  capacity: number;
  weddingDayId: string | null;
  assignments: Array<{ id: string; guestId: string | null; attendeeName: string; tableName: string | null; seatLabel: string | null }>;
};

export function WeddingSeatingPanel({ eventId }: { eventId: string }) {
  const [plans, setPlans] = useState<SeatingPlan[]>([]);
  const [unassigned, setUnassigned] = useState<Array<{ id: string; name: string }>>([]);
  const [days, setDays] = useState<WeddingDay[]>([]);
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState("");
  const [dayId, setDayId] = useState("");
  const [planId, setPlanId] = useState("");
  const [guestId, setGuestId] = useState("");
  const [tableName, setTableName] = useState("");
  const [seatLabel, setSeatLabel] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const [seating, weddingDays] = await Promise.all([
        api<{ plans: SeatingPlan[]; unassignedGuests: Array<{ id: string; name: string }> }>(`/api/events/${eventId}/wedding/seating`),
        api<{ days: WeddingDay[] }>(`/api/events/${eventId}/wedding/days`),
      ]);
      setPlans(seating.plans);
      setUnassigned(seating.unassignedGuests);
      setDays(weddingDays.days);
      setPlanId((current) => seating.plans.some((plan) => plan.id === current) ? current : seating.plans[0]?.id ?? "");
      setGuestId((current) => seating.unassignedGuests.some((guest) => guest.id === current) ? current : seating.unassignedGuests[0]?.id ?? "");
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load seating plans");
    }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function createPlan(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/seating`, {
        method: "POST",
        body: JSON.stringify({
          name,
          capacity: capacity ? Number(capacity) : 0,
          weddingDayId: dayId || undefined,
        }),
      });
      setName("");
      setCapacity("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create seating plan");
    }
  }

  async function assignGuest(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/seating/${planId}/assignments`, {
        method: "POST",
        body: JSON.stringify({ guestId, tableName: tableName || undefined, seatLabel: seatLabel || undefined }),
      });
      setTableName("");
      setSeatLabel("");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not seat this guest");
    }
  }

  async function removeAssignment(plan: SeatingPlan, assignmentId: string) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/seating/${plan.id}/assignments/${assignmentId}`, { method: "DELETE" });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not remove seating assignment");
    }
  }

  return <div className="workspace-body">
    <div className="section-heading"><div><div className="eyebrow">MAKE EVERYONE FEEL AT HOME</div><h2>Seating plans</h2></div><span className="item-count">{unassigned.length} guests unassigned</span></div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    <div className="two-column-panels">
      <form className="content-card stack-form compact-form" onSubmit={(event) => void createPlan(event)}>
        <div className="eyebrow">CREATE A PLAN</div><h3>Reception, ceremony, or day</h3>
        <label>Plan name<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="Reception tables" /></label>
        <label>Wedding day<select value={dayId} onChange={(event) => setDayId(event.target.value)}><option value="">All days / not specified</option>
          {days.map((day) => <option key={day.id} value={day.id}>{day.name} · {formatDate(day.date)}</option>)}
        </select></label>
        <label>Guest capacity<input type="number" min="0" value={capacity} onChange={(event) => setCapacity(event.target.value)} /><small className="muted">Set 0 for no capacity limit.</small></label>
        <button className="button button-dark">Create seating plan</button>
      </form>
      <form className="content-card stack-form compact-form" onSubmit={(event) => void assignGuest(event)}>
        <div className="eyebrow">FIND A SEAT</div><h3>Assign an attending guest</h3>
        <label>Seating plan<select required value={planId} onChange={(event) => setPlanId(event.target.value)}>
          <option value="">Choose a plan</option>
          {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
        </select></label>
        <label>Guest<select required value={guestId} onChange={(event) => setGuestId(event.target.value)}>
          <option value="">Choose a guest</option>
          {unassigned.map((guest) => <option key={guest.id} value={guest.id}>{guest.name}</option>)}
        </select></label>
        <div className="form-row"><label>Table<input value={tableName} onChange={(event) => setTableName(event.target.value)} placeholder="Table 1" /></label><label>Seat<input value={seatLabel} onChange={(event) => setSeatLabel(event.target.value)} placeholder="A3" /></label></div>
        <button className="button button-dark" disabled={!planId || !guestId}>Assign seat</button>
      </form>
    </div>
    <div className="two-column-panels">{plans.map((plan) => <section className="content-card" key={plan.id}>
      <div className="eyebrow">SEATING PLAN</div><h3>{plan.name}</h3>
      <small className="muted">{plan.assignments.length}{plan.capacity ? ` / ${plan.capacity}` : ""} assigned</small>
      <div className="admin-directory-list">{plan.assignments.map((assignment) => <article className="admin-list-item admin-user-row" key={assignment.id}>
        <strong>{assignment.attendeeName}</strong>
        <small>{[assignment.tableName, assignment.seatLabel].filter(Boolean).join(" · ") || "Seat not specified"}</small>
        <button className="text-button" onClick={() => void removeAssignment(plan, assignment.id)}>Unassign</button>
      </article>)}
      {!plan.assignments.length && <div className="empty-note">No guests assigned yet.</div>}</div>
    </section>)}</div>
  </div>;
}

export function WeddingWebsitePanel({ eventId, slug, startDate, endDate }: { eventId: string; slug: string; startDate: string; endDate: string }) {
  const [profile, setProfile] = useState<WeddingProfile>(blankProfile);
  const [faqText, setFaqText] = useState("");
  const [days, setDays] = useState<WeddingDay[]>([]);
  const [dayForm, setDayForm] = useState({ name: "", date: startDate.slice(0, 10), location: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [profileResult, daysResult] = await Promise.all([
        api<{ profile: (Partial<WeddingProfile> & { rsvpDeadline?: string | null }) | null }>(`/api/events/${eventId}/wedding/profile`),
        api<{ days: WeddingDay[] }>(`/api/events/${eventId}/wedding/days`),
      ]);
      const next = {
        ...blankProfile,
        ...profileResult.profile,
        rsvpDeadline: toLocalDateTime(profileResult.profile?.rsvpDeadline),
        faq: profileResult.profile?.faq ?? [],
      };
      setProfile(next);
      setFaqText(next.faq.map((item) => `${item.question} | ${item.answer}`).join("\n"));
      setDays(daysResult.days);
      setDayForm((current) => ({ ...current, date: current.date || startDate.slice(0, 10) }));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load wedding website settings");
    }
  }

  useEffect(() => { void load(); }, [eventId]);

  async function saveProfile(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    const faq = faqText.split("\n").map((line) => {
      const separator = line.indexOf("|");
      return separator < 0 ? null : {
        question: line.slice(0, separator).trim(),
        answer: line.slice(separator + 1).trim(),
      };
    }).filter((item): item is { question: string; answer: string } =>
      Boolean(item?.question && item.answer),
    );
    try {
      await api(`/api/events/${eventId}/wedding/profile`, {
        method: "PUT",
        body: JSON.stringify({
          ...profile,
          rsvpDeadline: profile.rsvpDeadline ? new Date(profile.rsvpDeadline).toISOString() : null,
          faq,
        }),
      });
      setMessage("Wedding website settings saved.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save wedding website");
    } finally {
      setBusy(false);
    }
  }

  async function createDay(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    try {
      await api(`/api/events/${eventId}/wedding/days`, {
        method: "POST",
        body: JSON.stringify(dayForm),
      });
      setDayForm({ name: "", date: startDate.slice(0, 10), location: "" });
      await load();
      setMessage("Wedding day added.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not add wedding day");
    }
  }

  async function toggleDay(day: WeddingDay) {
    setError("");
    try {
      await api(`/api/events/${eventId}/wedding/days/${day.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: day.name,
          date: day.date.slice(0, 10),
          location: day.location,
          isPublic: !day.isPublic,
          sortOrder: day.sortOrder,
        }),
      });
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update wedding day");
    }
  }

  const setText = (key: "headline" | "welcomeMessage" | "story" | "dressCode" | "travelInfo" | "invitationMessage") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setProfile((current) => ({ ...current, [key]: event.target.value }));
  const setVisibility = (key: "showStory" | "showDressCode" | "showTravelInfo" | "showSchedule" | "showRegistry" | "rsvpEnabled" | "showRsvpDeadline") =>
    (event: ChangeEvent<HTMLInputElement>) =>
      setProfile((current) => ({ ...current, [key]: event.target.checked }));

  return <div className="workspace-body">
    <div className="section-heading">
      <div><div className="eyebrow">A WELCOME BEFORE THE DAY</div><h2>Wedding website & invitations</h2></div>
      <a className="button button-outline" href={`/e/${slug}`} target="_blank" rel="noreferrer">Preview public page ↗</a>
    </div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {message && <div className="alert alert-success" role="status">{message}</div>}
    <div className="two-column-panels">
      <form className="content-card stack-form" onSubmit={(event) => void saveProfile(event)}>
        <div className="eyebrow">MAKE IT YOURS</div><h3>Public wedding details</h3>
        <label>Headline<input maxLength={160} value={profile.headline} onChange={setText("headline")} placeholder="A celebration with our favorite people" /></label>
        <label>Welcome message<textarea rows={3} maxLength={1000} value={profile.welcomeMessage} onChange={setText("welcomeMessage")} /></label>
        <label>Our story<textarea rows={4} maxLength={5000} value={profile.story} onChange={setText("story")} /></label>
        <label>Dress code<textarea rows={2} maxLength={500} value={profile.dressCode} onChange={setText("dressCode")} /></label>
        <label>Travel and accommodation<textarea rows={4} maxLength={3000} value={profile.travelInfo} onChange={setText("travelInfo")} /></label>
        <label>FAQs <small className="muted">One per line, formatted: Question | Answer</small>
          <textarea rows={5} value={faqText} onChange={(event) => setFaqText(event.target.value)} placeholder="Where should we park? | Parking is available at the venue." />
        </label>
        <label>RSVP deadline<input type="datetime-local" value={profile.rsvpDeadline} onChange={(event) => setProfile({ ...profile, rsvpDeadline: event.target.value })} /></label>
        <label>Invitation SMS template<textarea rows={3} maxLength={1000} value={profile.invitationMessage} onChange={setText("invitationMessage")} placeholder="Hello {name}, you're invited to {event}. RSVP here: {rsvpUrl}" />
          <small className="muted">Available tokens: {"{name}"}, {"{event}"}, {"{date}"}, {"{location}"}, {"{rsvpUrl}"}. RSVP links are always included.</small>
        </label>
        <div className="admin-directory-list">
          {([
            ["showStory", "Show our story"],
            ["showDressCode", "Show dress code"],
            ["showTravelInfo", "Show travel information"],
            ["showSchedule", "Show the schedule"],
            ["showRegistry", "Show the gift registry"],
            ["showRsvpDeadline", "Show the RSVP deadline"],
            ["rsvpEnabled", "Accept online RSVPs"],
          ] as const).map(([key, label]) => <label className="checkbox-label" key={key}>
            <input type="checkbox" checked={profile[key]} onChange={setVisibility(key)} />{label}
          </label>)}
        </div>
        <button className="button button-dark" disabled={busy}>{busy ? "Saving…" : "Save website settings"}</button>
      </form>
      <div className="content-card">
        <div className="eyebrow">CELEBRATION DAYS</div><h3>Plan a multi-day wedding</h3>
        <p className="muted small-copy">Each named day can have its own venue, schedule, and public visibility. Dates must be within {formatDate(startDate)}–{formatDate(endDate)}.</p>
        <form className="stack-form compact-form" onSubmit={(event) => void createDay(event)}>
          <label>Day or event name<input required value={dayForm.name} onChange={(event) => setDayForm({ ...dayForm, name: event.target.value })} placeholder="Traditional ceremony" /></label>
          <label>Date<input type="date" required min={startDate.slice(0, 10)} max={endDate.slice(0, 10)} value={dayForm.date} onChange={(event) => setDayForm({ ...dayForm, date: event.target.value })} /></label>
          <label>Location<input value={dayForm.location} onChange={(event) => setDayForm({ ...dayForm, location: event.target.value })} /></label>
          <button className="button button-outline">Add wedding day</button>
        </form>
        <div className="admin-directory-list">{days.map((day) => <article className="admin-list-item" key={day.id}>
          <strong>{day.name}</strong><small>{formatDate(day.date)}{day.location ? ` · ${day.location}` : ""}</small>
          <button className="text-button" onClick={() => void toggleDay(day)}>{day.isPublic ? "Hide from website" : "Make public"}</button>
        </article>)}
        {!days.length && <div className="empty-note">Add a ceremony, reception, or other celebration day.</div>}</div>
      </div>
    </div>
  </div>;
}
