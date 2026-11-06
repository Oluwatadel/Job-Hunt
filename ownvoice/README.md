# OwnVoice

A separate working AI writing-editor prototype, independent of Job Hunt.

Floot project: `d55a2adb-0461-4e79-99dd-b48279ba426d`. It has not been published.

## Features

- Natural, Academic, Professional and Casual tones; three rewrite strengths.
- Optional personal writing sample, sent with the draft as a style reference.
- Side-by-side review, highlighted new word occurrences, word counts, copy and plain-text export/import.
- Up to ten revisions in tab memory; optional device storage and a clear-history action. Device storage is not encrypted or shared across devices.
- Protected numerical values, common parenthetical/numerical citations, double-quoted passages and URLs. A rewrite that drops or duplicates a protected marker is rejected. These are syntactic checks: they do not prove factual equivalence, source authenticity, or correct attribution. Unrecognised citation styles still require manual review.

Floot uses its built-in AI service with `gpt-6-luna`. Each rewrite consumes the owner's Floot credits. No API key is needed for the Floot preview. Drafts and optional voice samples are sent to the AI provider; they are not stored in an application database. The app requests `store:false`; provider/platform processing policies apply.

No Turnitin integration, detector scores, guaranteed detector bypass, or validated competitor superiority is implemented or claimed. Establish quality through blinded human comparisons of meaning preservation, fluency, voice fidelity and citation integrity before making competitive claims.

## Local development

Use Node 22 or newer. From this directory:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm start
```

Open `http://localhost:3101`. UI works without credentials; rewriting reports that local AI is not configured. To enable local rewriting, copy `.env.example` to `.env` and provide your own `AI_API_KEY` and `AI_MODEL` for a Responses-compatible provider. Keep credentials out of source. `npm run dev` builds and starts; restart after edits.

`floot/` is the shared source. `portable/` implements a local Node server, a local AI adapter and build entry point. Never send portable files, package files or `.env` to Floot. The source manifest in `.floot-sync/manifest.json` tracks the managed shared files; unused Floot seeded kit files remain remote and are outside this managed subset. `npm run verify:sync` verifies the saved remote readback against local files, not current remote state. Read current remote versions through the connector before the next edit.

## Release status

Working private preview, not a production SaaS. Local server binds to loopback. Authentication, user-isolated cloud storage, payment/access enforcement and production abuse controls must be designed before any public release. Do not publish the current AI endpoint publicly. Existing Job Hunt accounts and entitlements do not carry over. Publishing and paid-service setup are separate release steps.
