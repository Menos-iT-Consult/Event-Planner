# EventFlow

EventFlow is a multi-event planning and ticketing platform built with React, TypeScript, Express, PostgreSQL, and Prisma. It includes event administration, day-based pricing, wedding guest workflows, voting contests, ticketing, QR passes, staff check-in, Cloudflare R2 storage, mNotify SMS, and Paystack payments.

## Requirements

- Node.js 20.19 or newer and npm
- PostgreSQL 14 or newer
- Provider accounts and credentials for Cloudflare R2, mNotify, and Paystack for their respective integrations

## Local setup

1. Install workspace dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, and an administrator email/password. Configure the provider credentials you intend to use. Do not commit `.env`.

3. Generate the Prisma client, create the database tables, seed the initial rate settings and administrator, and start both apps:

   ```powershell
   npm run db:generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

   The web app runs at `http://localhost:5173`; the API health check is at `http://localhost:4000/health`.

4. Configure the Paystack webhook URL as `{API_ORIGIN}/api/webhooks/paystack`. In local development, expose the API with a trusted HTTPS tunnel before configuring webhooks. The browser checkout callback is configured with `PAYSTACK_CALLBACK_URL`.

The web app uses Vite's `/api` proxy in local development. When hosting the web app separately from the API, set `VITE_API_URL` at build time to the API origin and set `WEB_ORIGIN` to the exact browser origin.

## Integrations

- **Pricing:** Seeded platform settings are editable by administrators. Event prices use decimal currency values and count inclusive calendar dates; same-day events count as one day. Rates are copied to each event at creation.
- **Cloudflare R2:** Objects are private. The API issues short-lived signed upload/read URLs. Configure the bucket CORS policy to allow the web origin for `PUT` uploads and expose the required content-type header. Images are limited to JPEG, PNG, and WebP, up to 5 MB.
- **mNotify:** SMS credentials are server-side only. Each message attempt is logged as queued, sent, or failed; bearer tokens in private RSVP/pass URLs are redacted from persisted message text. A successful provider response means accepted by mNotify, not confirmed handset delivery.
- **Paystack:** Ticket inventory is reserved during checkout and released if payment initialization fails or the 15-minute reservation expires. A verified late charge is refunded. Only verified `charge.success` webhooks fulfill ticket orders or apply paid votes; processing is idempotent and checks amount and currency.

## Useful commands

```powershell
npm run dev
npm run build
npm run typecheck
npm test
npm run db:generate
npm run db:migrate
npm run db:deploy
npm run db:seed
```

`npm run db:migrate` uses Prisma Migrate's development workflow and requires a reachable PostgreSQL database. Apply committed migrations with `npm run db:deploy` in production.

## Vercel multi-service deployment

The repository deploys as two services defined in `vercel.json`:

- `api` builds from `apps/api` and is publicly routed at `/api/*` and `/health`.
- `web` builds from `apps/web` and is publicly routed at `/*`.

Configure these environment variables in the Vercel project and expose them to both services:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
JWT_EXPIRES_IN=8h
COOKIE_SECURE=true
WEB_ORIGIN=https://your-production-domain.example
API_ORIGIN=https://your-production-domain.example
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong-password-at-least-12-characters>
WEDDING_DAILY_RATE=100
VOTING_DAILY_RATE=150
GENERAL_DAILY_RATE=125
```

`WEB_ORIGIN` must exactly match the browser origin sent by the web service, including `https://` and without a trailing slash. If a custom domain is used, configure it in both `WEB_ORIGIN` and `API_ORIGIN`.

After setting the environment variables, redeploy and apply the migration from a trusted local or CI shell:

```powershell
$env:DATABASE_URL='postgresql://...'
npm run db:deploy
npm run db:seed
```

Verify the API with `https://your-production-domain.example/health`. It should report `"database":"ok"`.

## Security and operations

- Admins, event managers, and check-in staff use HTTP-only session cookies; event-scoped manager and scanner access is checked against current database membership.
- Public RSVP and pass URLs contain high-entropy bearer tokens; only token hashes are persisted. Treat invitation/pass links as private.
- Paystack webhook signatures are checked against the raw request body. Payment fulfillment is idempotent and ticket passes are generated only after payment verification.
- Configure `COOKIE_SECURE=true` behind HTTPS in production, use strong unique secrets, restrict the R2 bucket and provider credentials, and configure database backups and monitoring.
- The built-in in-memory API rate limiter is intended for a single API instance. Use a shared rate-limit store or enforce equivalent limits at the edge before running multiple API replicas.

## Workspace layout

- `apps/api` — Express API, Prisma schema/seed, provider integrations, and API tests
- `apps/web` — React/Vite public pages, admin workspace, and mobile gate scanner
