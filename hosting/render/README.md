# Job Hunt: complete Render hosting setup

Prepared 4 November 2026. This package deploys the existing portable app to **Render**, with a separate **Render PostgreSQL 17** database. The included configuration creates a fresh installation. It has not created a hosting account, purchased services, deployed the app, or moved the Floot production database.

## 1. What you will run

| Part | Setup |
| --- | --- |
| Website, backend, sessions and realtime | One always-on Render Node.js web service; 512 MB starting size |
| Database | Managed PostgreSQL 17 in the same Frankfurt region; 5 GB storage |
| Application emails | Each user's authorized Gmail account, through Gmail's send API |
| CV and resume files | Each user's Google Drive; database holds references |
| Account/password-reset emails | Your SMTP provider and verified sending address |
| AI matching and drafts | Your own compatible API provider, key and model |
| Daily matching and background queue | Existing worker inside the single web service, enabled after setup |
| Domain and HTTPS | Assigned Render address initially; your own domain later |
| Backups | Render database recovery plus separately retained exports |

The app uses a process-local realtime bus, so keep **one web instance**. Render supports the inbound WebSockets this runtime needs. Splitting workers or adding replicas needs a reviewed shared realtime/scheduler design. [WebSocket support](https://render.com/docs/websocket).

## 2. Monthly budget

| Item | Starting budget, USD/month |
| --- | ---: |
| Web compute, `0.5c-512mb` | $7 |
| PostgreSQL compute, `0.1c-256mb` | $6 |
| Five GB PostgreSQL storage | Allow up to $1.50; check the included storage allowance |
| Infrastructure estimate | Approximately $13–$14.50 before usage extras and tax |
| Domain | Separate registrar cost; the Render subdomain can be used initially |
| AI and SMTP | Separate provider charges, depending on use |

These are small personal-app starting sizes, not a capacity guarantee. Check memory/CPU metrics after launch and raise the instance size if needed. Confirm Render's checkout estimate, bandwidth, build-minute and storage allowances before provisioning. Source: [Render pricing](https://render.com/pricing), corroborated by [Render's current compute examples](https://render.com/articles/production-rails-hosting-guide). This setup does not require a separate paid worker or cache initially.

## 3. Accounts and files you need

You need a GitHub repository containing this project, a Render account, and a Google Cloud project for Gmail/Drive consent. A custom domain, SMTP account, AI account and Stripe account are configured when you enable the corresponding features.

Use a **private repository** for the project. Include `floot/`, `portable/`, `scripts/`, `migrations/`, `render.yaml`, package files and the build/configuration files. Exclude `.env`, `.floot-sync/auth.json`, database dumps, uploaded personal documents, `node_modules/`, `dist/`, and unrelated personal folders. The existing `.gitignore` covers credentials and generated dependencies; inspect the staged file list before uploading. The repository is not yet linked to a remote in this workspace.

The key files are:

- `render.yaml`: web service, database, private database connection and deploy commands.
- `scripts/start-render.mjs`: sets the canonical application URL before starting the portable server.
- `scripts/check-deployment.mjs`: read-only HTTPS checks after deployment.
- `hosting/render/environment.example`: integration-variable reference; enter real values in Render, not here.
- `migrations/`: schema and runtime tables; no production rows or credentials.

## 4. Create the Render deployment

1. Upload the reviewed project files to your private GitHub repository.
2. In Render, choose **New → Blueprint** and connect that repository.
3. Use the root `render.yaml`. Review the paid web/database resources before creating them.
4. Enter `OWNER_EMAIL` as your actual email and set a new, unique `OWNER_PASSWORD` of at least 12 characters. `OWNER_NAME` defaults to Oluwatobi. The Blueprint generates `JWT_SECRET` and supplies the private `DATABASE_URL` automatically.
5. Apply the Blueprint. The Node.js build installs the lockfile dependencies and builds both frontend and backend. The pre-deploy command applies migrations and creates the owner on a fresh database. The service then starts and checks `/healthz`.
6. Open the assigned HTTPS address, go to `/login`, and sign in using the owner email/password you configured. Open `/admin` to check the owner account. Billing and scheduled matching start disabled.

Render runs migrations before each deploy, and an error stops deployment. The included migrator verifies previously applied migration hashes and refuses to apply the fresh baseline over an existing `users` table. Preserve the generated `JWT_SECRET`: it protects sessions and encrypts self-hosted Google tokens. After the owner is created, `OWNER_PASSWORD` can be removed from the service's environment; it is not a login-time password setting or a reset mechanism.

The bootstrap uses `RENDER_EXTERNAL_URL` until you explicitly set `APP_URL`. Render provides that HTTPS URL automatically. Manual deploys are selected (`autoDeployTrigger: off`), so later pushes do not immediately change the running app. [Blueprint reference](https://render.com/docs/blueprint-spec), [default environment variables](https://render.com/docs/environment-variables), [pre-deploy commands](https://render.com/docs/deploys).

## 5. Set up Gmail and Drive

This is the important part for seeing application emails in your Gmail Sent folder.

In Google Cloud:

1. Create or choose your own project. Enable the **Gmail API** and **Google Drive API**.
2. Configure the Google Auth consent screen, contact details and audience. For a private trial, add your Gmail address as a test user.
3. Create a **Web application OAuth client** for integrations. Register the exact redirect address below, replacing the origin with the deployed HTTPS address:

   ```text
   https://YOUR-APP.onrender.com/__runtime/google/callback
   ```

4. In Render's **Environment** tab, set `GOOGLE_INTEGRATION_CLIENT_ID` and `GOOGLE_INTEGRATION_CLIENT_SECRET` from that client. Save and deploy the environment change.
5. In Job Hunt, open **Settings → Choose Gmail account**. Sign in to the actual Gmail address whose Sent folder you want to use, and approve the requested access.
6. Open **Documents** and upload your CV/resume PDFs. Confirm the displayed sender address in Settings and in the application email form.
7. Prepare an email to an address you control, review its contents and attachment, then explicitly send it. Verify it appears in the sending account's **Sent** and that **View email in Gmail Sent** opens it. A delivery or read receipt from the recipient is separate from Gmail accepting the send.

The runtime requests identity plus `drive.file` and, when email is enabled, `gmail.send`. It does not need a Gmail password or app password. OAuth redirect URIs must match exactly. Keep Google sign-in separate: if you also want Google as a Job Hunt login option, use the identity variables `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` and register `https://YOUR-HOST/_api/auth/oauth_callback` for that client. Password sign-in works without it. [Google web-server OAuth setup](https://developers.google.com/identity/protocols/oauth2/web-server), [Google scopes](https://developers.google.com/identity/protocols/oauth2/scopes).

Before allowing public users, complete Google's production requirements for your requested scopes and audience, including the applicable app/domain verification and public policy pages. Do not assume a test-user configuration is a permanent public launch. [Google production-readiness requirements](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance).

Connecting Gmail in this chat does not connect Gmail inside the hosted app. SMTP configuration below sends account messages; employer applications use the user's Gmail API connection.

## 6. Configure the remaining services

Enter these in the Render web service's Environment tab. Optional features remain unavailable until their settings are supplied.

| Feature | Environment variables / action |
| --- | --- |
| Password reset email | `SMTP_URL`, `MAIL_FROM`; verify your sending domain with your SMTP provider and add its required DNS records |
| AI features | `AI_API_KEY`, `AI_MODEL`, optional `AI_BASE_URL`; use a Responses-compatible model supporting this app's web-search/PDF requests |
| Daily job matching | Configure AI, review your career profile, enable the user's daily matching preference, then set `ENABLE_SCHEDULER=true` |
| Browser push | Generate a new VAPID key pair; set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; rebuild because the public key is embedded in frontend code |
| GitHub / LinkedIn login | Corresponding `*_OAUTH_CLIENT_ID` / `*_OAUTH_CLIENT_SECRET`; register `https://YOUR-HOST/_api/auth/oauth_callback` |
| Paid membership | Your own supported Stripe business account and live credentials, as described below |

For SMTP credentials containing special characters, URL-encode the username/password components. Keep the SMTP sender on a provider-verified domain. Test the password-reset flow before depending on it for recovery.

The existing scheduler uses **08:00 Africa/Lagos** and saves matching opportunities for review. It does not automatically send employer emails or complete employer forms. Owner access is free; customer automation still requires a current confirmed paid period or an explicit admin grant. Keep one scheduler instance, and disable the old Floot matching schedule before enabling the new one during cutover to prevent two installations running independently.

The project already supports Stripe in the portable runtime. To enable it, supply `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `STRIPE_WEBHOOK_SECRET`; configure the customer portal; register `https://YOUR-HOST/_api/payments/event` for `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, and `invoice.payment_failed`. Finish provider testing separately and deliberately enable billing in Owner admin. Use an account supported for your business; an ordinary hosting deployment does not create one. Existing Floot-managed subscriptions do not transfer by copying their IDs into a different Stripe account.

## 7. Add your domain

Add the domain under the Render service's **Settings → Custom Domains**, copy Render's exact DNS instructions to your DNS provider, and wait for verification and HTTPS. Then set `APP_URL` to the canonical HTTPS origin, such as `https://jobs.example.com`, and deploy. Use that address for the app, OAuth callbacks and billing webhooks. Update each provider's registered URLs and reconnect integrations if required. Render issues and renews HTTPS certificates. [Custom-domain guide](https://render.com/docs/custom-domains).

Do not invent a DNS target from an example. Copy the target Render gives this service. The `oluwatobi-job-hunt.floot.app` address belongs to Floot's domain and cannot be pointed at Render as your own custom hostname.

## 8. Verify the deployment

From the project directory, run:

```powershell
node scripts/check-deployment.mjs https://YOUR-HOST
```

This checks health, frontend routes and private API rejection without signing in or transmitting email. It does not prove the database or external integrations work.

Then perform the real signed-in checks:

- Sign in, create a manual job entry and refresh it to confirm database persistence.
- Confirm Owner admin is accessible to the owner and unavailable to a regular account.
- Connect Gmail in Settings and upload a PDF in Documents.
- Send one reviewed test application to an address you control; verify the sender, attachment, Gmail Sent link and email history.
- Save a career profile and test a single AI draft/match before enabling daily matching.
- Request a password reset and confirm account mail arrives.
- Open two signed-in windows and check realtime updates; reconnect after deployment.

Do not advertise an integration as live until its real-provider check succeeds. The automated app tests simulate providers and do not send real Gmail messages.

## 9. Backups, upgrades and rollback

Use the database's **Recovery** page for point-in-time restoration and logical exports. Paid Render databases support continuous recovery; the documented Hobby window is three days and Pro or higher is seven. Export and retain separate encrypted copies according to your chosen retention policy. Store those copies and the preserved JWT secret outside this source repository. [Database recovery and backups](https://render.com/docs/postgresql-backups).

Before an update, make a database export and note the currently deployed commit. Run `npm run build` and `npm test`, push the reviewed commit, then manually deploy it in Render. Pre-deploy migration logs must succeed. Rerun the deployment checks and the relevant signed-in feature checks.

For a code-only regression, redeploy the previous known-good commit. A code rollback does not undo a database migration: only roll code back when its schema remains compatible, or restore into a separate database and validate recovery first. Test restoration periodically. Do not delete the former production database during a cutover.

## 10. Moving existing Floot records

The default Blueprint starts empty except for the new owner. Copying code does not copy applications, users, document references, Google consent, uploads, subscriptions or Floot infrastructure.

If you want your previous application history, keep the new service private to your launch process while you export the Floot database and review a separate data migration. Restore into an isolated staging database, reconcile schema/runtime migrations, preserve tenant IDs and constraints, and reset identity sequences after imports. The fresh-baseline migrator intentionally refuses to overwrite an existing user database; do not bypass that guard blindly.

Move legacy Floot CV files into Drive or upload them again. Users reconnect Google to your own OAuth client. Identity-provider client changes may require explicit account linking or password recovery. Review active subscriptions independently before changing billing. After verifying the new app and any imported history, deliberately switch your own domain and disable the former scheduler. Keep the Floot installation as a recovery option until the new deployment is confirmed.

## 11. Common setup failures

| Symptom | Check |
| --- | --- |
| Deployment fails before startup | Migration logs, fresh database requirement, owner password length and database connectivity |
| Google redirect mismatch | Exact deployed origin and `/__runtime/google/callback`; login uses a different callback |
| Application email absent from Sent | Confirm sender in Settings, Gmail authorization and receipt history; do not treat a manual Applied status as proof |
| Session keeps expiring or Google tokens fail after a deploy | Preserved `JWT_SECRET`, correct HTTPS `APP_URL`, and current Google consent |
| Password-reset email fails | SMTP credentials, verified sender and provider delivery logs |
| Daily search never runs | `ENABLE_SCHEDULER`, user opt-in/profile/access, AI key/model and runtime job records |
| Realtime rejects the browser | Open the canonical `APP_URL` domain; keep one app instance |
| Legacy resume cannot be downloaded | Original binary remains in Floot; migrate or upload it again |

## Prepared state

The Blueprint passed validation against Render's published JSON schema. The production build, all 11 regression cases, and a local smoke test of the Render startup script passed on 4 November 2026. The smoke test used dummy configuration and made no real database or email calls. The live HTTPS probe is ready to run after deployment.

No Render account resources or production data have been created or changed. Gmail, SMTP, AI, DNS and payment credentials still require your own provider setup. Host-specific files are intentionally separate from the shared `floot/` source and are not uploaded as Floot virtual files.
