import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Authentication required"}' }),
  );
});

test("public home page renders the event platform entry point", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("heading", { name: /make room for the meaningful/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your workspace" })).toHaveAttribute("href", "/login");
});

test("product landing pages preserve the selected workspace through signup", async ({ page }) => {
  await page.goto("/weddings");

  await expect(page.getByRole("heading", { name: /wedding planning, with room to enjoy it/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your workspace" })).toHaveAttribute("href", "/signup?next=%2Fweddings");
  await expect(page.getByRole("link", { name: "Voting & Contests" })).toHaveAttribute("href", "/voting");
});

test("signup deep link still renders after a direct navigation and reload", async ({ page }) => {
  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Create your account" })).toBeVisible();
});

test("password recovery provides a non-enumerating success response", async ({ page }) => {
  await page.route("**/api/auth/forgot-password", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ message: "If an account exists for this email, recovery instructions will be sent." }),
    }),
  );
  await page.goto("/forgot-password");

  await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible();
  await page.getByLabel("Email address").fill("guest@example.com");
  await page.getByRole("button", { name: "Send recovery details" }).click();
  await expect(page.getByText(/if an account exists/i)).toBeVisible();
});

test("users can review and revoke active sessions", async ({ page }) => {
  const user = { id: "manager-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" };
  let othersRevoked = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  await page.route("**/api/auth/sessions", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        sessions: [
          { id: "session-current", device: "Current browser", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-11-12T00:00:00.000Z", expiresAt: "2026-11-12T08:00:00.000Z", current: true },
          ...(!othersRevoked ? [{ id: "session-other", device: "Other browser", createdAt: "2026-01-01T00:00:00.000Z", lastUsedAt: "2026-11-11T00:00:00.000Z", expiresAt: "2026-11-12T08:00:00.000Z", current: false }] : []),
        ],
      }),
    }),
  );
  await page.route("**/api/auth/sessions/revoke-others", async (route) => {
    othersRevoked = true;
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"revoked":1}' });
  });

  await page.goto("/security/sessions");
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await expect(page.getByText("Other browser")).toBeVisible();
  await page.getByRole("button", { name: "Sign out other sessions" }).click();
  await expect(page.getByText("1 other session signed out.")).toBeVisible();
  await expect(page.getByText("Other browser")).toHaveCount(0);
});

test("sign in completes a two-factor challenge", async ({ page }) => {
  let authenticated = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: authenticated ? 200 : 401,
      contentType: "application/json",
      body: authenticated
        ? JSON.stringify({ user: { id: "user-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" } })
        : '{"error":"Authentication required"}',
    }),
  );
  await page.route("**/api/auth/login", async (route) => {
    const request = route.request();
    const body = request.postDataJSON() as { code?: string };
    if (!body.code) {
      await route.fulfill({
        status: 401,
        contentType: "application/json",
        body: '{"error":"A two-factor authentication code is required"}',
      });
      return;
    }
    authenticated = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ user: { id: "user-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" } }),
    });
  });
  await page.route("**/api/events", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' }),
  );
  await page.route("**/api/organizations", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"organizations":[]}' }),
  );

  await page.goto("/login");
  await page.getByLabel("Email address").fill("amina@example.com");
  await page.getByLabel("Password").fill("Correct-Horse-Battery");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/two-factor$/);
  await page.getByLabel("Authentication code").fill("123456");
  await page.getByRole("button", { name: "Verify and sign in" }).click();
  await expect(page.getByRole("heading", { name: "Good morning, Amina" })).toBeVisible();
});

test("guest can RSVP and open the digital pass", async ({ page }) => {
  await page.route("**/api/public/rsvp/invite-token", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          invitation: {
            name: "Ama",
            plusOnesAllowed: 1,
            status: "PENDING",
            event: {
              title: "Ama & Kofi's Wedding",
              startDate: "2027-06-12T00:00:00.000Z",
              endDate: "2027-06-12T00:00:00.000Z",
              location: "Accra",
            },
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        guest: { status: "ATTENDING" },
        passUrl: "/pass/pass-token",
        smsStatus: "SENT",
      }),
    });
  });

  await page.goto("/rsvp/invite-token");
  await page.getByLabel("Dietary needs").fill("Vegetarian");
  await page.getByRole("button", { name: "Send my RSVP" }).click();
  await expect(page.getByText(/we can’t wait to celebrate with you/i)).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your digital pass" })).toHaveAttribute("href", "/pass/pass-token");
});

test("event manager can create an event", async ({ page }) => {
  test.setTimeout(90_000);
  const user = { id: "manager-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" };
  let createdType: string | undefined;
  let createdOrganizationId: string | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  await page.route("**/api/events", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as { type: string; organizationId: string };
      createdType = body.type;
      createdOrganizationId = body.organizationId;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ event: { id: "event-1" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' });
  });
  await page.route("**/api/organizations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        organizations: [{
          id: "org-1",
          name: "Amina's Events",
          slug: "aminas-events",
          role: "OWNER",
          _count: { memberships: 1, events: 0 },
        }],
      }),
    }),
  );
  await page.route("**/api/events/event-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          id: "event-1",
          slug: "ama-kofi-wedding",
          title: "Ama & Kofi Wedding",
          type: "WEDDING",
          startDate: "2027-06-12T00:00:00.000Z",
          endDate: "2027-06-12T00:00:00.000Z",
          durationDays: 1,
          totalCost: "0",
          dailyRate: "0",
          currency: "GHS",
          location: "Accra",
          isPublished: false,
          _count: { guests: 0, categories: 0, orders: 0 },
        },
      }),
    }),
  );
  for (const resource of ["guests", "budget", "vendors", "registry", "categories", "sessions", "ticket-tiers", "analytics"]) {
    await page.route(`**/api/events/event-1/${resource}`, (route) => {
      const key = resource === "registry" || resource === "budget" ? "items" : resource;
      const empty = resource === "analytics"
        ? { guests: 0, checkedIn: 0, paidOrders: 0, ticketRevenue: "0", voteRevenue: "0", totalRevenue: "0", smsSent: 0 }
        : [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ [key]: empty }),
      });
    });
  }
  await page.route("**/api/events/event-1/wedding/checklist", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"tasks":[]}' }),
  );
  await page.route("**/api/events/event-1/wedding/days", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"days":[]}' }),
  );

  await page.goto("/weddings");
  await page.getByRole("button", { name: "New wedding" }).click();
  await page.getByLabel("Event name").fill("Ama & Kofi Wedding");
  await page.getByLabel("Starts").fill("2027-06-12");
  await page.getByLabel("Ends").fill("2027-06-12");
  await page.getByLabel("Location").fill("Accra");
  await page.getByRole("button", { name: /create event/i }).click();
  await expect.poll(() => createdType).toBe("WEDDING");
  await expect.poll(() => createdOrganizationId).toBe("org-1");
  await expect(page).toHaveURL(/\/events\/event-1$/);
  await expect(page.getByRole("heading", { name: "Ama & Kofi Wedding" })).toBeVisible();
});

test("organization owners can manage members and review organization audit history", async ({ page }) => {
  test.setTimeout(60_000);
  const user = { id: "owner-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" };
  let assignedRole: string | undefined;
  let auditQuery: string | null = null;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  await page.route("**/api/organizations", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        organizations: [{
          id: "org-1",
          name: "Amina's Events",
          slug: "aminas-events",
          role: "OWNER",
          _count: { memberships: 1, events: 0 },
        }],
      }),
    }),
  );
  await page.route("**/api/organizations/org-1/members", async (route) => {
    if (route.request().method() === "POST") {
      assignedRole = route.request().postDataJSON().role;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"membership":{"userId":"finance-1","role":"FINANCE"}}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        members: [{
          userId: "owner-1",
          role: "OWNER",
          createdAt: "2026-01-01T00:00:00.000Z",
          user: { name: "Amina Mensah", email: "amina@example.com", emailVerifiedAt: null },
        }],
      }),
    });
  });
  await page.route("**/api/organizations/org-1/audit**", (route) => {
    auditQuery = new URL(route.request().url()).searchParams.get("q");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        logs: [{
          id: "audit-1",
          action: "CREATE_ORGANIZATION",
          entityType: "organization",
          createdAt: "2026-01-01T00:00:00.000Z",
          actor: { id: "owner-1", name: "Amina Mensah" },
        }],
      }),
    });
  });
  await page.route("**/api/subscriptions/plans", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ plans: [], providers: { PAYSTACK: false, MOOLRE: false } }),
    }),
  );
  await page.route("**/api/subscriptions/organizations/org-1", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ subscription: null, invoices: [] }),
    }),
  );

  await page.goto("/organizations", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Organization members" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Organization billing" })).toBeVisible();
  await expect(page.getByText("No active subscription.")).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await page.getByLabel("Email address").fill("finance@example.com");
  await page.getByLabel("Role").selectOption("FINANCE");
  await page.getByRole("button", { name: "Add or update member" }).click();
  await expect(page.getByText("Organization access updated.")).toBeVisible();
  await expect(page.getByText("CREATE ORGANIZATION", { exact: true })).toBeVisible();
  expect(assignedRole).toBe("FINANCE");
  await page.getByLabel("Search audit history").fill("organization");
  await expect.poll(() => auditQuery).toBe("organization");
});

test("platform administrators can open the central control center", async ({ page }) => {
  test.setTimeout(60_000);
  const user = { id: "admin-1", name: "Amina Mensah", email: "admin@example.com", role: "ADMIN", mfaEnabled: true };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  const responses: Record<string, unknown> = {
    settings: { settings: [
      { key: "WEDDING_DAILY_RATE", value: "10", description: "Wedding rate" },
      { key: "VOTING_DAILY_RATE", value: "15", description: "Voting rate" },
      { key: "GENERAL_DAILY_RATE", value: "20", description: "General rate" },
    ] },
    "subscription-plans": { plans: [] },
    overview: {
      events: 3,
      guests: 42,
      votes: 88,
      paidOrders: 9,
      contactMessages: 1,
      staff: 4,
      revenue: "1250.00",
      byType: [
        { type: "WEDDING", _count: { _all: 1 } },
        { type: "VOTING", _count: { _all: 1 } },
        { type: "GENERAL", _count: { _all: 1 } },
      ],
    },
    contact: { messages: [] },
    audit: { logs: [] },
    organizations: { organizations: [{ id: "org-1", name: "EventFlow", slug: "eventflow", _count: { users: 4 } }] },
    "features/refunds": { refunds: [] },
    "features/jobs": { jobs: [] },
    "features/provider-health": {
      providers: { database: "ready", sms: "ready", payments: "not_configured", objectStorage: "ready", email: "not_configured" },
      history: {},
      operations: { smsFailures: 0, failedJobs: 0, deadJobs: 0, pendingJobs: 0, deletionRequests: 0 },
    },
    "features/data-deletion-requests": { requests: [] },
    users: { users: [{ id: "admin-1", name: user.name, email: user.email, role: user.role, emailVerifiedAt: "2026-01-01T00:00:00.000Z", createdAt: "2026-01-01T00:00:00.000Z" }] },
  };
  await page.route(/\/api\/admin\//, async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").filter(Boolean).slice(2);
    const key = path[0] === "features" ? `features/${path[1]}` : path[0];
    const body = responses[key];
    if (!body) {
      await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unknown admin endpoint"}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.goto("/admin", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Platform overview" })).toBeVisible();
  await expect(page.getByText("Events on platform")).toBeVisible();
  await expect(page.getByText("Recorded revenue")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Events by type" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connected services" })).toBeVisible();

  await page.getByRole("button", { name: "People" }).click();
  await expect(page.getByRole("heading", { name: "Create a platform account" })).toBeVisible();
  await expect(page.getByText("admin@example.com")).toBeVisible();

  await page.getByRole("button", { name: "Operations" }).click();
  await expect(page.getByRole("heading", { name: "Contact inbox" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Audit history" })).toBeVisible();
});

test("each event type opens its own event workspace components and data", async ({ page }) => {
  test.setTimeout(120_000);
  const user = { id: "manager-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  const loadedResources = new Map<string, Set<string>>();
  const eventTypes = [
    { id: "wedding-event", type: "WEDDING", title: "Ama & Kofi Wedding" },
    { id: "voting-event", type: "VOTING", title: "Community Awards" },
    { id: "general-event", type: "GENERAL", title: "Product Summit" },
  ];
  await page.route(/\/api\/events\//, async (route) => {
    const path = new URL(route.request().url()).pathname.split("/").filter(Boolean);
    const eventIndex = path.indexOf("events");
    const eventId = path[eventIndex + 1];
    const resource = path[eventIndex + 2];
    const event = eventTypes.find((item) => item.id === eventId);
    if (!event) {
      await route.fallback();
      return;
    }
    if (!resource) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          event: {
            id: event.id,
            slug: event.id,
            title: event.title,
            type: event.type,
            startDate: "2027-06-12T00:00:00.000Z",
            endDate: "2027-06-13T00:00:00.000Z",
            durationDays: 2,
            totalCost: "20",
            dailyRate: "10",
            currency: "GHS",
            location: "Accra",
            isPublished: true,
            _count: { guests: 1, categories: 1, orders: 1 },
          },
        }),
      });
      return;
    }

    const resources = loadedResources.get(event.id) ?? new Set<string>();
    resources.add(resource);
    loadedResources.set(event.id, resources);
    const bodies: Record<string, unknown> = {
      guests: { guests: [] },
      budget: { items: [] },
      vendors: { vendors: [] },
      registry: { items: [] },
      sessions: { sessions: [] },
      "ticket-tiers": { tiers: [] },
      categories: {
        categories: [{ id: "category-1", name: "Community Choice", candidates: [{ id: "candidate-1", name: "Afi", votesCount: 8 }] }],
      },
      analytics: { guests: 0, checkedIn: 0, paidOrders: 0, ticketRevenue: "0", voteRevenue: "0", totalRevenue: "0", smsSent: 0 },
    };
    if (resource === "wedding") {
      const weddingResource = path[eventIndex + 3];
      resources.add(`wedding/${weddingResource}`);
      const weddingBodies: Record<string, unknown> = {
        checklist: { tasks: [] },
        days: { days: [] },
        households: { households: [] },
        seating: { plans: [], unassignedGuests: [] },
        profile: { profile: null },
      };
      const weddingBody = weddingBodies[weddingResource];
      if (!weddingBody) {
        await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unknown wedding resource"}' });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(weddingBody) });
      return;
    }
    const body = bodies[resource];
    if (!body) {
      await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unknown workspace resource"}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  for (const event of eventTypes) {
    await page.goto(`/events/${event.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: event.title })).toBeVisible({ timeout: 20_000 });
    if (event.type === "WEDDING") {
      await expect(page.getByText("Guests attending")).toBeVisible();
      await expect(page.getByText("Budget planned")).toBeVisible();
      await expect.poll(() => [...loadedResources.get(event.id) ?? []]).toContain("wedding/checklist");
      expect([...loadedResources.get(event.id) ?? []].sort()).toEqual(["analytics", "budget", "guests", "registry", "sessions", "vendors", "wedding", "wedding/checklist", "wedding/days"]);
      await page.locator(".workspace-tabs").getByRole("button", { name: "Checklist" }).click();
      await expect(page.getByRole("heading", { name: "Wedding checklist" })).toBeVisible();
      await page.locator(".workspace-tabs").getByRole("button", { name: "Seating" }).click();
      await expect(page.getByRole("heading", { name: "Seating plans" })).toBeVisible();
      await page.locator(".workspace-tabs").getByRole("button", { name: "Website & invites" }).click();
      await expect(page.getByRole("heading", { name: "Wedding website & invitations" })).toBeVisible();
      await page.locator(".workspace-tabs").getByRole("button", { name: "Guests" }).click();
      await expect(page.getByRole("heading", { level: 2, name: /guest list/i })).toBeVisible();
      await expect(page.getByText("Organize your guest list")).toBeVisible();
      await page.locator(".workspace-tabs").getByRole("button", { name: "Programme" }).click();
      await expect(page.getByRole("heading", { name: "Wedding programme" })).toBeVisible();
    } else if (event.type === "VOTING") {
      await expect(page.getByText("Contest categories")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Leaderboard" })).toBeVisible();
      await expect(page.getByText("Afi")).toBeVisible();
      expect([...loadedResources.get(event.id) ?? []].sort()).toEqual(["analytics", "categories"]);
    } else {
      await expect(page.getByText("Registrations")).toBeVisible();
      await expect(page.getByText("Tickets claimed")).toBeVisible();
      expect([...loadedResources.get(event.id) ?? []].sort()).toEqual(["analytics", "guests", "sessions", "ticket-tiers"]);
    }
  }
});

test("event staff can manually check in a pass", async ({ page }) => {
  const user = { id: "staff-1", name: "Kwame Boateng", email: "kwame@example.com", role: "CHECK_IN_STAFF" };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  await page.route("**/api/events/event-1/check-in", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ checkedIn: true, attendee: "Ama" }),
    }),
  );

  await page.goto("/scanner/event-1");
  await page.getByLabel("Pass code or URL").fill("pass-token");
  await page.getByRole("button", { name: "Check in" }).click();
  await expect(page.getByText("Ama is checked in. Welcome!")).toBeVisible();
});
