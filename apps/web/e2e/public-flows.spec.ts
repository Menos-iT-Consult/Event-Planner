import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Authentication required"}' }),
  );
});

test("public home page renders the event platform entry point", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: /make room for the meaningful/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open your workspace" })).toHaveAttribute("href", "/login");
});

test("product landing pages preserve the selected workspace through signup", async ({ page }) => {
  await page.goto("/weddings");

  await expect(page.getByRole("heading", { name: /wedding planning, with room to enjoy it/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create your workspace" })).toHaveAttribute("href", "/signup?next=%2Fweddings");
  await expect(page.getByRole("link", { name: "Voting & Contests" })).toHaveAttribute("href", "/voting");
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
  const user = { id: "manager-1", name: "Amina Mensah", email: "amina@example.com", role: "EVENT_MANAGER" };
  let createdType: string | undefined;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ user }) }),
  );
  await page.route("**/api/events", async (route) => {
    if (route.request().method() === "POST") {
      createdType = route.request().postDataJSON().type;
      await route.fulfill({
        status: 201,
        contentType: "application/json",
        body: JSON.stringify({ event: { id: "event-1" } }),
      });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: '{"events":[]}' });
  });
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
      const key = resource === "registry" ? "items" : resource;
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

  await page.goto("/weddings");
  await page.getByRole("button", { name: "New wedding" }).click();
  await page.getByLabel("Event name").fill("Ama & Kofi Wedding");
  await page.getByLabel("Starts").fill("2027-06-12");
  await page.getByLabel("Ends").fill("2027-06-12");
  await page.getByLabel("Location").fill("Accra");
  await page.getByRole("button", { name: /create event/i }).click();
  expect(createdType).toBe("WEDDING");
  await expect(page).toHaveURL(/\/events\/event-1$/);
  await expect(page.getByRole("heading", { name: "Ama & Kofi Wedding" })).toBeVisible();
});

test("each event type opens its own event workspace components and data", async ({ page }) => {
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
      budget: { budget: [] },
      vendors: { vendors: [] },
      registry: { items: [] },
      sessions: { sessions: [] },
      "ticket-tiers": { tiers: [] },
      categories: {
        categories: [{ id: "category-1", name: "Community Choice", candidates: [{ id: "candidate-1", name: "Afi", votesCount: 8 }] }],
      },
      analytics: { guests: 0, checkedIn: 0, paidOrders: 0, ticketRevenue: "0", voteRevenue: "0", totalRevenue: "0", smsSent: 0 },
    };
    const body = bodies[resource];
    if (!body) {
      await route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"Unknown workspace resource"}' });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  for (const event of eventTypes) {
    await page.goto(`/events/${event.id}`);
    await expect(page.getByRole("heading", { name: event.title })).toBeVisible();
    if (event.type === "WEDDING") {
      await expect(page.getByText("Guests attending")).toBeVisible();
      await expect(page.getByText("Budget planned")).toBeVisible();
      expect([...loadedResources.get(event.id) ?? []].sort()).toEqual(["analytics", "budget", "guests", "registry", "sessions", "vendors"]);
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
