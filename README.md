# Job Hunt source and future deployment

This project contains the same application source used in Floot, plus a standalone Node/React/PostgreSQL runtime. The current Floot address is https://oluwatobi-job-hunt.floot.app. Source changes in the editor are previews until Floot publishes them. This package does not change that published version by itself.

## What is included

- `floot/`: canonical application source shared with Floot, including Google, LinkedIn and GitHub sign-in, tenant isolation, owner administration and payment-gated automation.
- `portable/`: replacements for Floot's managed services on your own hosting.
- `migrations/`: database structure, without exporting the existing database's rows.
- `scripts/sync.mjs`: OAuth-authenticated source synchronization, with version checks, conflict refusal, backups and remote typechecking.
- `Dockerfile`, `compose.yaml`, `.env.example`: future hosting configuration.
- `tests/`: isolated PostgreSQL, OAuth, payment access, HTTP and sync regression tests.

## Deploy on Render

The ready-to-configure hosting package is [render.yaml](render.yaml). Follow the complete [Render setup guide](hosting/render/README.md) for the database, Gmail/Drive, domain, optional services, deployment checks and backups. This provisions a fresh installation; production records and Floot credentials require a separate migration.

## Application email settings

Open **Settings** in the signed-in app and choose **Choose Gmail account**. Authorize the Google account whose Sent folder should contain your applications. This connection is separate from signing in to Job Hunt or connecting Gmail to this chat. The connected address is shown as the sender before every email application.

Upload your CV/resume in **Documents**, open the job, prepare the email, review its recipient and attachments, then choose **Send reviewed application**. Only a successful Gmail API response with a message ID records the email as Sent. Settings and the application show **View email in Gmail Sent**, opening the sending account. A send confirmation does not establish that an employer received or read it. Unknown outcomes are held for review without automatic retries.

To switch addresses, use **Settings → Change email account**. Disconnecting also removes this app’s Drive document references and Gmail message links; PDFs and sent emails remain in Google. Connect the new account and upload its documents again. Historical application notes alone are not verified send receipts.

## Local installation

Install Node.js 22.16 or newer and PostgreSQL 17 or newer. In this directory:

```sh
npm ci --legacy-peer-deps
```

Copy `.env.example` to `.env`. Set `DATABASE_URL`, a random `JWT_SECRET` of at least 32 characters, `OWNER_EMAIL`, `OWNER_NAME` and a new `OWNER_PASSWORD` of at least 12 characters. Use a fresh database. Then:

```sh
npm run db:migrate
npm run build
npm test
npm start
```

Open `http://localhost:3000`. Sign in using the owner email/password you configured. The migration creates the owner only on a fresh database; subsequent runs do not reset passwords. `npm run dev` rebuilds and starts the same runtime; restart it after source edits.

The basic app, manual tracking and admin tools do not need AI, payment or Google credentials. Those features remain unavailable until their environment settings are provided. No dummy credential enables them. Local HTTP cookies work only for `localhost` or `127.0.0.1`; use HTTPS elsewhere.

## Membership and social sign-in

New users can register with email/password or an enabled social provider. They receive the `user` role and no free automation grant. Free accounts can prepare a profile, connect their own Drive and manually track up to the configured free limit. Automation, AI profile extraction, AI drafts and reviewed Gmail sending require an active subscription with a confirmed, non-zero paid invoice whose period is still current. Trials, unpaid checkouts, expired paid periods and past-due subscriptions do not unlock those features.

The owner remains free. The owner's separate `/admin` dashboard can grant or revoke complimentary access and suspend accounts. The default plan is **NGN 5,000 per month**. Billing starts disabled until the owner configures and enables it. A free-access grant does not cancel any existing subscription.

Google sign-in is provisioned in Floot. LinkedIn/GitHub are implemented but disabled until their app credentials are configured. For self-hosting, configure all desired providers in `.env`; their callback is:

```
https://YOUR-DOMAIN/_api/auth/oauth_callback
```

For Floot, register `https://oluwatobi-job-hunt.floot.app/_api/auth/oauth_callback` in the LinkedIn/GitHub developer apps and connect their client IDs and secrets through Floot's secure credential form. LinkedIn needs the **Sign In with LinkedIn using OpenID Connect** product and `openid profile email`. GitHub needs an OAuth app with `read:user user:email`; repository access is not requested. GitHub uses S256 PKCE. Google sign-in asks for identity only.

An existing account is never silently merged based on email. Sign in using its current method, then use **Profile → Sign-in accounts** to link a provider. If your owner account has no password yet, use the existing password-reset flow in Floot first. Provider identity is resolved by its stable subject, not a changeable email. Users whose provider does not return a verified email can use another sign-in method.

## Keep Floot and this code synchronized

The first sync command opens a Floot authorization page in your browser. This authorizes the source-sync CLI separately from this chat's existing Floot connection. Tokens stay in ignored `.floot-sync/auth.json`; keep this folder private. No API key is pasted into source.

Before editing:

```sh
npm run sync:pull
```

Edit files inside `floot/`, then:

```sh
npm run build
npm test
npm run sync:plan
npm run sync:push
```

Push builds locally, uses Floot's project version to prevent overwriting concurrent edits, typechecks remotely and reads changed files back before advancing the baseline. Conflicting edits or deleted files stop synchronization for review. Pull preserves replaced local files under ignored `.floot-sync/backups/`. Schema migrations, secrets, uploaded assets, deployment settings and database contents are **not** source files and are not synchronized by this command.

For automatic local-file updates while you work:

```sh
npm run sync:watch
```

Keep that terminal running. It pulls once at startup, pushes local changes after a successful build, and stops on a conflict. Edits made only in Floot are brought back by `sync:pull` or by restarting the watcher; there is no unattended remote polling. Future assistants must follow `AGENTS.md` and update both source copies. The workflow is not a guarantee that arbitrary edits made elsewhere synchronize while this computer or the watcher is off. Publishing remains separate and deliberate.

Floot's connector calls count toward its daily build-action allowance. The version shortcut avoids reading every file when the remote project has not changed; remote changes can require a full source read. Native Folder Sync is also available on Floot paid plans, with review before applying differences. See [Floot MCP connection](https://floot.com/docs/integrations/other-mcp-clients) and [code and exports](https://floot.com/docs/faqs/code-data-and-exports).

## Future production hosting

Set `APP_URL` to your HTTPS domain. Configure a reverse proxy with WebSocket upgrades and persistent PostgreSQL backups. Use one application replica: realtime currently uses a per-process event bus. Before scaling, replace it with a shared broker. The durable database queue supports background matching. Set `ENABLE_SCHEDULER=true` only on the intended scheduler/worker instance. The shared schedule is 08:00 Africa/Lagos; the task checks each user's current payment/grant again before running.

For Docker, add `POSTGRES_PASSWORD` to `.env` (use a URL-safe random value), set the HTTPS `APP_URL`, then:

```sh
docker compose build
docker compose up -d db
docker compose run --rm app node scripts/migrate.mjs
docker compose up -d app
```

Expose the loopback port through your HTTPS reverse proxy. The Docker image does not contain `.env`, OAuth tokens or the source-control directory. Use a secret manager or protected server environment for real credentials. Update an existing deployment by backing up PostgreSQL, building the new image, applying reviewed migrations and restarting the app. Never change an already-applied migration; add a new one.

Self-hosted service configuration:

| Feature | Configuration |
| --- | --- |
| Google sign-in | `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` |
| LinkedIn / GitHub sign-in | Corresponding `*_OAUTH_CLIENT_ID` and `*_OAUTH_CLIENT_SECRET` |
| Personal Drive / Gmail | Separate `GOOGLE_INTEGRATION_CLIENT_ID` / `GOOGLE_INTEGRATION_CLIENT_SECRET`; callback `/__runtime/google/callback` |
| Membership payments | Your own `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`; webhook `/_api/payments/event` |
| AI matching / extraction / drafts | `AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL`; Responses API with web-search/PDF support required |
| Password reset mail | `SMTP_URL`, verified `MAIL_FROM` |
| Optional browser push | Your own VAPID pair; rebuild with `VAPID_PUBLIC_KEY` when it changes |

Subscribe the Stripe webhook to `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` and `invoice.payment_failed`. The app verifies signatures and re-fetches subscription/invoice ownership and mode before updating access. Production rejects Stripe test keys. Self-hosting uses your own Stripe account, not Floot's payment service. Configure its customer portal before enabling billing.

The Google integration requests `drive.file` for files this app creates and `gmail.send` only when the user selects email applications. Each user connects their own Google account. Document files stay in that account's Drive; the app stores file references and the profile facts the user explicitly saves. Self-hosted Google refresh tokens are encrypted with a key derived from `JWT_SECRET`. Preserve that secret across restarts or reconnect users after key rotation. Your Google developer app may require provider verification before public use.

AI provider usage is billed by your configured provider; the legacy Floot-credit field is zero outside Floot and is not a cost estimate. The adapter uses the [Responses API documented by OpenAI](https://developers.openai.com/api/reference/resources/responses/methods/create), with `store:false` and a model chosen in your environment. The runtime does not automatically submit arbitrary employer forms: matching saves suggestions, application emails need explicit review, and employer account verification/assessments still require the applicant.

## Existing data and migration limits

This export does not copy production database rows, managed Google tokens, Stripe account data or Floot-hosted binary assets. A fresh deployment is a new database. Existing private legacy Floot resume files must be moved into each user's Drive in Floot before migration, or uploaded again afterwards. Legacy storage SDK calls deliberately fail closed outside Floot; new Drive uploads work through the Google integration adapter.

For an eventual move of existing accounts, export/back up the database separately using Floot's database tools and have the schema/data migration reviewed. The included migration command refuses to overwrite an existing users table. Keep a data snapshot and source checkpoint, restore into an isolated database, reconcile its schema with the baseline, then record the reviewed baseline before applying the portable-runtime migration. Adjust identity sequences after imports. Google/LinkedIn subjects and credentials can depend on the broker/client: use the existing account recovery method and explicit profile linking, rather than merging by email. Users will need to reconnect Drive/Gmail to the self-hosted Google client.

Subscriptions belong to a Stripe account. Floot-managed customer/subscription IDs cannot simply be used with a different Stripe account. Review the billing transition separately and prevent double billing; do not automatically cancel or recreate customers' subscriptions as a source-sync operation. A source-only sync never transfers records or changes customers' billing.

The old embedded worker key was removed during this export. A private external worker, if needed, must derive its `x-ingest-secret` using HMAC-SHA256 of `job-hunt-ingest-v1` with the server's `JWT_SECRET`; never send the JWT secret itself. Tenant-targeted worker requests must also pass the current paid/grant check. Do not expose this credential to a browser.

## Validation and current release status

On 4 November 2026 the production build and all 11 local regression cases passed. The Render Blueprint validated against Render's current published JSON schema, and the Render startup script passed a local smoke test using dummy configuration. The shared Gmail settings changes were previously read back from Floot and verified against all 437 local app files; Floot typechecking passed. Hosting-only configuration is kept outside the shared application source.

The full Render setup is in [hosting/render/README.md](hosting/render/README.md). No Render resources have been provisioned and no production records have been transferred. Provider consent, Gmail/SMTP delivery, payment collection, AI, DNS and database migration need their real-account checks before launch. The included deployment checker covers HTTP responses, not those integrations.

New Floot code is saved in the editor and has not been republished in this flow. Self-hosting is a separate deployment using your own provider accounts. Docker is an alternative package; the Render setup uses the native Node.js runtime and was validated without relying on Docker Desktop.