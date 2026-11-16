# Project instructions

## Database access — DBHub MCP

- Manage and inspect project databases through DBHub MCP. Load
  `.opencode/skills/dbhub-explore/SKILL.md` before schema discovery or SQL and
  `.opencode/skills/dbhub-setup/SKILL.md` for connection setup or diagnosis.
- OpenCode starts `dbhub` (local `karaoke`) and `dbhub-prod` (live VPS
  `karaoke-prod` over SSH) independently. Select the intended MCP server
  explicitly; each exposes `search_objects` and `execute_sql` without a source
  suffix because it has only one source. Discover schemas and use `main.table`.
- Local writes require an authorized task. Production is technically read-only;
  production reads require an explicit production request. If a write is needed,
  obtain explicit authorization for its scope and configuration change first.
  Never bypass a DBHub rejection with a different client.
- People use `make db` for local sqlit and `make db-prod` for a read-only live
  sqlite3 console over SSH. `make db-sync` refreshes local sqlit configuration;
  `make db-check` verifies both MCP connections with `SELECT 1`, or use
  `connection=karaoke` / `connection=karaoke-prod` to select one.
- Keep `.env`, `.env.prod`, SSH keys and generated `.sqlit` state private.
  Preserve the application's data directory and SQLite WAL files; never copy or
  network-mount a live database for tool access. See `docs/database-tools.md`.

## Playback diagnosis and local reproduction

For playback incidents, production log investigation or explicitly requested
playback reproduction, load `.opencode/skills/karaoke-diagnostics/SKILL.md` and follow
`docs/playback-diagnostics.md`. Use `npm run diagnostics -- help` for the bounded
tools. Production collection requires an explicit production-read request;
local scenarios use temporary data. Never equate a passing synthetic scenario
with reproduction of a production incident.
Routine playback edits do not require this diagnostic workflow; choose any
verification using the risk-based policy below.

## Development mode — fast, proportional delivery

This project is in active development. Default to a short loop: inspect the
affected code, implement the smallest complete change, and summarize. Verify only
when a concrete uncertainty, meaningful risk or explicit request warrants it.

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

## Environments and HTTPS validation

- **Production:** **https://karaoke.puyu.pe/** points to the VPS at
  **74.208.127.50**, served by Plesk/Nginx and `karaoke.service` on
  **http://127.0.0.1:3010**. It is not the local development tunnel. Do not use
  this hostname for development tests or fixtures; production operations require
  an explicit production request.
- **Temporary development:** **https://dev-karaoke.puyu.pe/** uses Cloudflare
  Tunnel to **http://127.0.0.1:3000** on the local machine. Use this HTTPS URL for
  development browser validation and administrator, player, guest and QR flows.
  The local application and tunnel are managed by the user services
  `karaoke-eternal.service` and `karaoke-eternal-tunnel.service`.
- Check whether the local server is already running before starting `npm run dev`.
  It uses backend watch mode and frontend HMR; normal edits do not need a full
  build or a tunnel restart. Preserve the existing `.env` and configured data
  directory when starting the application.
- Preserve development `no-store` headers, hashed JS/CSS filenames and the
  refreshed HTML index. If changes appear stale, check compilation and browser/
  CDN responses before changing cache rules or restarting services.
- When browser verification is warranted by the policy below, use the HTTPS URL
  with Playwright. If the tunnel is unavailable, use relevant local evidence and
  report the HTTPS gap only if it matters to the task. Do not claim a
  localhost-only check covers the tunnel.
- Existing `config/*.e2e.mjs` suites launch isolated local servers with temporary
  databases; use them only when their coverage resolves a concrete risk. Do not
  automatically pair an isolated suite with an HTTPS smoke test. Keep automated
  fixtures and destructive tests off shared data.
- Before enabling an E2E suite's HTTPS mode, check its target hostname. Older
  suites may still hardcode `karaoke.puyu.pe`; point them at the development
  hostname before use. Keep local and VPS data independent after the migration.
- Tunnel setup and diagnostics: `odd/tasks/cloudflare-development-tunnel.md`.
- Production provisioning, deployment and recovery: `docs/production-deployment.md`.

## Runtime parity — Node 24

- These runtime requirements apply when verification is needed; they do not
  require running checks, preparing a runtime or building for every change.
- Run tests, type checks, verification builds and isolated reproduction servers
  with **Node 24**, matching production. Use the documented production patch
  (**24.22.2**, see `docs/production-deployment.md`) when available; report any
  patch mismatch explicitly. Passing checks on Node 26 do not establish readiness.
- Check `node --version` inside the selected environment before verification.
  Select the runtime for the entire command, including npm and child servers:
  `mise exec node@24.22.2 -- npm test -- <test-file-or-directory>`. Use an explicit
  Node 24 binary/PATH when mise is unavailable. Do not change global runtime settings.
- Reproduce compatibility bugs on Node 24 before fixing them and keep a focused
  regression for the failing contract. Do not infer SQLite or other runtime API
  behavior from a newer local Node version. If Node 24 is unavailable, prepare it
  or report verification as blocked rather than substituting a newer major.

## Verification — proportional to actual risk

Verification is not an automatic step for every edit. For any clear, localized,
low-risk change, inspection of the affected code and resulting diff can be
sufficient. This applies to application logic, UI, audio, configuration and
documentation alike; file type or subsystem alone does not trigger checks.

| Situation | Response |
| --- | --- |
| Clear, localized change with no concrete uncertainty | Implement and inspect; no test, lint, typecheck, build or browser run is required. |
| Specific uncertainty or plausible regression | Use the smallest check that can resolve it: a focused test, lint/type check, brief manual check or narrow smoke test. |
| Consequential contract or cross-cutting behavior change | Select focused coverage for the affected behavior and failure path; broaden only when findings justify it. |
| Explicit verification request or required CI gate | Honor that scope without adding unrelated suites. |

- Before launching a check, identify what uncertainty it resolves. Do not create
  tests that merely mirror an edit, or run commands as a completion ritual.
- Assess actual behavior and blast radius, not line count alone. Changes to
  authorization, stored data, queue coordination or audio ownership may warrant
  regression coverage even when small; touching those areas does not mandate a
  broad suite.
- Development/production E2E pairs, long waits, diagnostic bundles, full suites
  and production builds are not defaults. Use them only for a demonstrated need,
  such as mode-specific behavior, a build/runtime risk or an explicit request.
- Stop when the relevant uncertainty is resolved. Do not repeat passing checks
  or broaden verification without new evidence. A flaky unrelated scenario does
  not expand a punctual task into a test-infrastructure repair.
- Keep the final report brief and truthful about checks actually performed and
  any material gap. Inspection-only delivery is valid; do not describe unrun
  tests as passed or create a blocker merely because they were not run.

This policy governs verification scope in the project UI rules and local skills
below. Skill activation alone must not trigger a test or diagnostic workflow.

## UI and UX — required skill

For every task that creates or changes UI/UX (layout, styling, interaction,
controls, loading/empty/error states, or accessibility), load and follow the
Anthropic `frontend-design` skill and the local `karaoke-ui` skill **before editing
the interface**:

- Skill: `.opencode/skills/frontend-design/SKILL.md`
- Provenance: `.opencode/skills/frontend-design/SOURCE.md`
- Project UI rules: `.opencode/skills/karaoke-ui/SKILL.md`

Reuse the existing karaoke theme, components and application structure. For new
or reshaped interfaces, define visual hierarchy and interaction states briefly
before implementation; a separate design document is not required. When visual
verification is warranted, inspect relevant mobile and desktop screenshots.
Preserve Spanish UI copy and use English identifiers and technical comments.

Prioritize an intuitive, simple UI with fewer elements. Do not add supporting
text that repeats controls, explains internal rules, or describes obvious
behavior. Use clear labels and visual hierarchy instead. If users can complete
the action without reading an explanation, omit it; do not replace it with a
tooltip, badge, or help icon by default. Show brief, actionable messages only
when an error, a blocking condition, or an empty state needs guidance. Preserve
essential status feedback and accessible labels. Apply these rules to every UI
change, not only the karaoke search.

Do not leave primary actions disabled without a visible explanation and a next
step. Distinguish requesting an announcement from authorizing public playback:
waiting for audio preparation must not silently prevent a valid pending request.

Choose UI verification using the risk-based policy above. When a browser check
is warranted, focus on the affected interaction, including keyboard or responsive
behavior where relevant. A punctual UI edit does not automatically require
Playwright, screenshots or player/audio E2E suites.

Keep the vendored skill unchanged; document project conventions here and apply
them through the local `karaoke-ui` companion skill.

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

## Resource promotion from development — project skill

For requests to publish tested resources or settings from development to the VPS,
load `.opencode/skills/promote-resources/SKILL.md`. Use its `resources:promote`
CLI to compare explicit room scopes, bundle media, publish through authenticated
APIs and resume receipts. See `docs/resource-promotion.md`. Production reads and
writes require an explicit production request. Deploy the accompanying backend
before importing birthday assets; never replace the live database to promote content.
Use `resources:promote:calls` for selected name pronunciations and “para escuchar”
introductions, preserving exact WAV masters, MP3s, aliases and template bindings.

## YouTube resource imports from chat — project skill

For downloading or trimming YouTube audio/video and importing it into the audio
catalog, transition backgrounds or local library, load
`.opencode/skills/youtube-resource-import/SKILL.md`. Use its import CLI and the
existing authenticated HTTPS APIs. Preserve receipts for retries, verify the
target room, and distinguish importing resources from selecting or playing them.
