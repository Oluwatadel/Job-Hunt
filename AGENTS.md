# Shared app source policy

The user requires updates in BOTH Floot and this deployable source project.

- Floot project ID: `92321d51-8624-4e4c-9762-079a2ab08b23`.
- Canonical shared source: `floot/`. Host-specific runtime: `portable/`. Never send portable runtime, package files or secrets to Floot as virtual items.
- Before editing, compare remote state with `.floot-sync/manifest.json`. Pull nonconflicting remote changes. Stop on competing edits or deletions and preserve both versions for review.
- Edit shared source once, mirror it through the connected Floot tools or `npm run sync:push`, and read changed remote files back to verify equality. Use `expected_version` on every remote write. Do not report both copies updated until verified.
- Build and run relevant tests locally. Run Floot typechecking after shared changes. Refresh the sync manifest only after verifying remote content. If the connector is unavailable, clearly report which source copy remains pending; do not claim synchronization.
- Keep database migrations in `migrations/`. Apply reviewed schema changes to the intended Floot database and update its generated schema helper. Never execute the fresh-database baseline on the existing Floot database. Database rows, OAuth credentials, provider settings and binary assets are separate from source sync.
- Keep social sign-in separate from Google Drive/Gmail consent. New accounts are users, with no complimentary access. Existing-account linking requires an authenticated session. Never merge or grant admin based solely on provider email.
- Automation is gated on a current confirmed paid invoice period, the owner, or a current admin grant. Keep both scheduled tasks and direct requests gated. Trials, a successful login and an unpaid checkout confer no automation access.
- Do not print secrets or copy `.env`/CLI OAuth credentials into source, logs or archives.
- Publishing, production data migration and changes to paid provider services remain separate release steps. State any outstanding setup accurately.
