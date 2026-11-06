# Project instructions

## Development mode — fast, proportional delivery

This project is in active development. Default to a short loop: inspect the
affected code, implement the smallest complete change, verify it, and summarize.

- Implement clear, reversible requests directly. Reserve formal plans, SDD
  artifacts, issues, review rounds and approval checkpoints for explicit requests
  or consequential ambiguity; do not introduce them for routine changes.
- Reuse existing patterns and dependencies. Avoid speculative abstractions,
  unrelated refactors and production-hardening work outside the requested scope.
- Inspect only the relevant flow and load only applicable skills. Keep progress
  updates and the final report brief: changes, actual checks, remaining blockers.
- Reuse installed dependencies, running services and incremental compilation.
  Reinstall, rebuild or restart only when the change or a diagnosed failure
  requires it. Do not repeat passing checks without new changes or evidence.

## Local development and HTTPS validation

- The shared development URL is **https://karaoke.puyu.pe/**, exposed through
  Cloudflare Tunnel to **http://127.0.0.1:3000**. Use HTTPS for browser validation
  and administrator, player, guest and QR flows. A public hostname does not make
  this a production deployment.
- Check whether the local server is already running before starting `npm run dev`.
  It uses backend watch mode and frontend HMR; normal edits do not need a full
  build or a tunnel restart. Preserve the existing `.env` and configured data
  directory when starting the application.
- Preserve development `no-store` headers, hashed JS/CSS filenames and the
  refreshed HTML index. If changes appear stale, check compilation and browser/
  CDN responses before changing cache rules or restarting services.
- Verify the affected user flow through the HTTPS URL with Playwright. If the
  tunnel is unavailable, continue with local checks and report HTTPS validation
  as pending. Do not claim a localhost-only check covers the tunnel.
- Existing `config/*.e2e.mjs` suites launch isolated local servers with temporary
  databases; use them for repeatable regression checks, alongside the relevant
  HTTPS smoke test. Keep automated fixtures and destructive tests off shared data.
- Tunnel setup and diagnostics: `odd/tasks/cloudflare-development-tunnel.md`.

## Minimum quality — choose checks by impact

| Change | Verification |
| --- | --- |
| Documentation/instructions only | Review the diff, referenced paths and commands; run `git diff --check`. |
| Application logic or bug fix | Run focused tests with `npm test -- <test-file-or-directory>` and lint changed JS/TS files with `npx --no-install eslint <files>`. Run `npm run typecheck` when TypeScript changes. |
| UI/UX | Exercise the affected flow in Playwright over HTTPS; apply the UI checks below. |
| Player/audio lifecycle | Run the affected regression scenarios in development (React StrictMode) and production, using isolated data/ports. Include the affected HTTPS playback flow. |
| Authentication, persistence or queue coordination | Add or run focused regression coverage for the changed contract and its relevant failure path. |

Apply the relevant rows together. Add tests for meaningful new behavior or a
reproducible bug; avoid tests that only mirror implementation or cosmetic edits.
Reserve full-suite runs and production builds for cross-cutting changes,
dependency/build configuration changes, required CI checks or explicit requests.
Build the needed target when a focused production check requires it. Report
failures and untested behavior honestly; fix regressions introduced by the change.

## UI and UX — required skill

For every task that creates or changes UI/UX (layout, styling, interaction,
controls, loading/empty/error states, or accessibility), load and follow the
Anthropic `frontend-design` skill **before editing the interface**:

- Skill: `.opencode/skills/frontend-design/SKILL.md`
- Provenance: `.opencode/skills/frontend-design/SOURCE.md`

Reuse the existing karaoke theme, components and application structure. For new
or reshaped interfaces, define visual hierarchy and interaction states briefly
before implementation; a separate design document is not required. For visual
changes, inspect screenshots at mobile and desktop sizes. Preserve Spanish UI
copy and use English identifiers and technical comments.

Do not leave primary actions disabled without a visible explanation and a next
step. Distinguish requesting an announcement from authorizing public playback:
waiting for audio preparation must not silently prevent a valid pending request.

Verify the changed flow with Playwright, including keyboard use for affected
controls and responsive layouts for visual changes. Keep checks focused on the
changed behavior; use the quality table above for player/audio lifecycle changes.

Keep the vendored skill unchanged; document project conventions here.

## Expressive animator audio — project skill

For ElevenLabs v4 animator scripts, emotion/audio tags, Il Gatto welcomes or
voice-generation integration, load `.opencode/skills/elevenlabs-animator/SKILL.md`.
Its local references distinguish provider capabilities from project limits and
include a copy-ready welcome example. A script suggestion does not authorize
generation or public playback; follow the user's requested operation.

## Animator catalog batches — project skill

For approved animator audio batches, load
`.opencode/skills/animator-catalog-batch/SKILL.md` together with
`elevenlabs-animator`. Use the existing authenticated production API and its
worker for generation, persistence and audio preparation. Preserve exact
approved scripts and record job IDs for resumable execution. Valid generated
resources become automatically eligible in the catalog; communicate this
behavior before submission and preserve the room's playback controls.
