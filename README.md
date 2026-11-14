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
   npm run test:e2e
   npm run dev
   ```

   The web app runs at `http://localhost:5173`; the API health check is at `http://localhost:4000/health`.

4. Configure the Paystack webhook URL as `{API_ORIGIN}/api/webhooks/paystack` and the Moolre callback URL as `{API_ORIGIN}/api/webhooks/moolre`. In local development, expose the API with a trusted HTTPS tunnel before configuring webhooks. The browser checkout callback is configured with `PAYSTACK_CALLBACK_URL`.

The web app uses Vite's `/api` proxy in local development. When hosting the web app separately from the API, set `VITE_API_URL` at build time to the API origin and set `WEB_ORIGIN` to the exact browser origin.

## Integrations

- **Wedding planning:** Wedding workspaces include milestone checklists, multi-day schedules, household guest lists with bulk SMS invitations, seating plans, budget/vendor payment tracking, a configurable public wedding website, and a quantity-aware gift registry. RSVP deadlines and public schedule, story, travel, dress-code, and registry visibility are configurable per wedding. The wedding planning migration must be applied before deploying these workflows.
- **Pricing:** Seeded platform settings are editable by administrators. Event prices use decimal currency values and count inclusive calendar dates; same-day events count as one day. Rates are copied to each event at creation.
- **Cloudflare R2:** Objects are private. The API issues short-lived signed upload/read URLs. Configure the bucket CORS policy to allow the web origin for `PUT` uploads and expose the required content-type header. Images are limited to JPEG, PNG, and WebP, up to 5 MB.
- **mNotify:** SMS credentials are server-side only. Each message attempt is logged as queued, sent, or failed; bearer tokens in private RSVP/pass URLs are redacted from persisted message text. A successful provider response means accepted by mNotify, not confirmed handset delivery.
- **Paystack:** Ticket inventory is reserved during checkout and released if payment initialization fails or the 15-minute reservation expires. A verified late charge is refunded. Only verified `charge.success` webhooks fulfill ticket orders, apply paid votes, or activate subscription invoices; processing is idempotent and checks amount and currency.
- **Moolre:** Configure the API user, public key, receiving account number, billing email, and a callback secret of at least 32 characters. The callback validates the shared secret, invoice reference, receiving account, amount, currency, and success state before activating an organization subscription.
- **OIDC:** Configure the issuer URL, client ID, and client secret. Register `{API_ORIGIN}/api/auth/oidc/callback` as the provider's redirect URI. Sign-in is restricted to existing accounts with a provider-verified email; optional comma-separated email domains can restrict account linking. OIDC discovery and signing keys are fetched from the configured issuer.
- **Organization subscriptions:** Platform administrators manage GHS monthly/yearly plans in the central admin dashboard. Owners and administrators can check out through configured Paystack or Moolre providers; finance members can view billing. Successful verified payments activate a plan and apply its optional event/member limits. Renewals are manual one-time checkouts, not automatic recurring charges.
- **Central admin email:** Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and `EMAIL_FROM` to enable platform invitations and password-reset emails. New team members receive a one-use invitation link and set their own password; the admin dashboard does not issue temporary passwords or grant platform-admin roles.

## Useful commands

```powershell
npm start
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
- The API compiles to CommonJS so Vercel's generated `src/app.js` runs without relying on package-level ESM metadata.

Configure these environment variables in the Vercel project and expose them to both services:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
JWT_SECRET=<at-least-32-random-characters>
JWT_EXPIRES_IN=8h
MFA_ENCRYPTION_KEY=<separate-random-secret-at-least-32-characters>
COOKIE_SECURE=true
WEB_ORIGIN=https://your-production-domain.example
API_ORIGIN=https://your-production-domain.example
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=<strong-password-at-least-8-characters>
WEDDING_DAILY_RATE=100
VOTING_DAILY_RATE=150
GENERAL_DAILY_RATE=125
```

`WEB_ORIGIN` must exactly match the browser origin sent by the web service, including `https://` and without a trailing slash. If a custom domain is used, configure it in both `WEB_ORIGIN` and `API_ORIGIN`.

Production Vercel API builds apply committed Prisma migrations with `npm run db:deploy` before compiling; preview builds skip production migrations. For deployments outside Vercel, apply migrations from a trusted environment:

```powershell
$env:DATABASE_URL='postgresql://...'
npm run db:deploy
```

Run `npm run db:seed` separately only when you intentionally need to initialize seed data.

Verify the API with `https://your-production-domain.example/health`. It should report `"database":"ok"`.

## Security and operations

- Each event belongs to an organization. Organization owners, administrators, and event managers can manage its events; finance and auditor memberships do not grant event-workspace access. Event check-in staff access remains event-scoped.
- Sign-up creates a personal organization. Owners can create additional organizations and manage registered members from the Organizations workspace; platform administrators can assign members in any organization.
- Platform administrators invite event managers and check-in staff by email from People & access. Invitation and password-reset links are single-use and expire; disabling an account revokes its active sessions. Admins can search accounts, review email/MFA status, and send password-reset emails. Configure the SMTP settings described above for these email actions.
- Sessions use random opaque HTTP-only cookies whose hashes are stored in the database. Users can inspect and revoke sessions; password resets revoke every session, and password changes revoke all other sessions.
- Platform administrators must enroll in TOTP before using platform, organization, or event APIs. TOTP secrets are encrypted at rest with `MFA_ENCRYPTION_KEY`; if omitted, the API derives the encryption key from `JWT_SECRET`. Keep the encryption key stable or existing authenticator secrets will need to be re-enrolled after key rotation. Backup codes are stored as hashes.
- OIDC identity linking requires a verified email from the configured issuer and never creates accounts automatically. Restrict allowed domains where appropriate and protect OIDC client credentials and callback configuration.
- Subscription activation is driven only by provider callbacks: Paystack signatures are verified against the raw body; Moolre callbacks must match the configured secret and the invoice's reference, account, amount, and currency. Configure callback URLs and secrets before enabling a provider in production.
- Successful mutating API requests are audited using route templates, actor, request ID, and event/organization scope; request bodies and secrets are not copied into audit metadata. Organization owners, administrators, and auditors can search the latest 100 organization audit entries by action, record, or actor.
- Account owners can download a JSON export of profile, organization/event memberships, consent, session, sign-in, and audit metadata. It excludes password hashes, bearer tokens, and MFA secrets.
- Before deploying this schema, review the organization backfill migration on staging and run `npm run db:deploy` before switching the API to the new code. Verify event ownership and organization membership after migration. Existing JWT-only cookies are not valid database sessions, so users must sign in again after deployment.
- Public RSVP and pass URLs contain high-entropy bearer tokens; only token hashes are persisted. Treat invitation/pass links as private.
- Paystack webhook signatures are checked against the raw request body. Payment fulfillment is idempotent and ticket passes are generated only after payment verification.
- Configure `COOKIE_SECURE=true` behind HTTPS in production, use strong unique secrets, restrict the R2 bucket and provider credentials, and configure database backups and monitoring.
- The built-in in-memory API rate limiter is intended for a single API instance. Use a shared rate-limit store or enforce equivalent limits at the edge before running multiple API replicas.
- Public feature routes have a general per-IP limit; opt-out attempts and privacy requests have stricter per-IP limits. Keep equivalent protections at the edge when scaling out.
- Refund requests are accepted only for paid orders belonging to the published event, and must match the order's full amount and currency. Refund completion is claimed once; if the Paystack result is ambiguous, verify it in the provider dashboard before resolving or retrying the request.
- Background jobs that remain unresponsive for an hour are marked dead for operator review rather than automatically re-executed, since the external side effect may already have occurred. Active jobs renew their lease every ten minutes. Verify provider state before manually retrying a recovered job.
- Scheduled SMS is sent once at its scheduled time. Partial or interrupted delivery is reported for operator review and is not automatically retried, to avoid duplicate texts. SMS readiness checks verify configuration, not end-to-end provider delivery.
- Privacy deletion requests remain pending for an administrator to verify identity, review legal retention obligations, fulfill the request, and then mark it complete. The request queue does not automatically delete account or event data.
- Use your PostgreSQL provider's automated backups or point-in-time recovery. Keep backups encrypted and access-restricted, define a recovery-point objective, and periodically restore a backup into an isolated database before applying production migrations. Verify the app against the restored database before treating the restore as successful.
- The application does not configure database backups, disaster-recovery targets, or alert delivery for you. Set and test those with your database/monitoring providers; record service-level objectives, recovery-point/recovery-time targets, on-call ownership, and an incident-response contact before production use.
- Generic OIDC sign-in is available for existing, email-verified accounts. SAML SSO and SCIM provisioning are not implemented.
- QR check-in requires a live API connection so each pass can be validated and atomically marked used. The scanner deliberately does not admit an unverified pass offline; an offline mode requires signed offline credentials and duplicate-reconciliation controls across scanners.
- Organization event and member limits are checked when creating events or adding members under an active plan. These checks do not retroactively remove existing data when a plan expires or changes. Subscription renewal is manual; recurring billing, prorations, and payment-provider dispute automation are not implemented. Event-level refund and operational actions do not yet have configurable multi-person approval workflows.
- Run `npm run test:e2e` for the browser smoke tests; these mock the authentication and password-recovery API responses and do not replace database-backed integration or payment-provider tests.

## Workspace layout

- `apps/api` — Express API, Prisma schema/seed, provider integrations, and API tests
- `apps/web` — React/Vite public pages, admin workspace, and mobile gate scanner
