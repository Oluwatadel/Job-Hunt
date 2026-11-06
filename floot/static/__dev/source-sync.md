# Source synchronization requirement

The owner keeps a deployable code project at:
`C:/Users/DELL/Documents/Codex/2026-10-29/ca/outputs/job-hunt-code`

All shared application updates must be mirrored in this project's `floot/` directory. Follow its `AGENTS.md`. Compare before writing, refuse competing edits, run local validation and Floot typechecking, read changed remote files back, and update `.floot-sync/manifest.json` only after verification.

If editing Floot from an agent without access to that folder, clearly tell the owner a local `npm run sync:pull` is still required. Never claim the local code changed when it was inaccessible. The supplied CLI can watch local edits and push them while running; remote-only edits require a pull/restart. Publishing is separate from code synchronization.

Do not put secrets, database exports or uploaded documents in source. New social users receive no automation access until a paid invoice is confirmed, except for explicit owner/admin complimentary access.
