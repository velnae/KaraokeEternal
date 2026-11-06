# Existing application workflow

## Manifest and authorization

Treat `assets/general-voices-01.json` as a historical approved example, not
permission to generate it in a later session. For another batch, prepare a new
manifest and establish that request's approval and generation scope.

Resolve each input as `{ ...manifest.defaults, ...item }`. Send only
`{ inputs: resolvedInputs }` to the production endpoint; manifest labels,
room assertions and approval notes are execution context, not API fields.
Check `expectedRoomId` and `expectedRoomName` against the authenticated admin's
current room before any POST. The API derives room/user from the session.

Preserve the exact resolved request in an ignored execution receipt before
submission. Record each response's job IDs immediately. Do not store cookies,
tokens, provider credentials or personal account information in receipts.

## Preflight through the running HTTPS application

Use the authenticated browser session at the project URL from `AGENTS.md`.
Inspect the room in the admin UI and available resources before submitting.
Use same-origin requests with the existing session, not a new provider client.

| Request | Purpose |
| --- | --- |
| `GET /api/animation/resources` | Inspect catalog, preparation and metadata; follow pagination. |
| `GET /api/animation/providers` | Check processor and provider capabilities/model. |
| `GET /api/animation/production` | Inspect existing jobs and configured remaining capacity. |
| `POST /api/animation/production/check` with `{ "providerId": "elevenlabs", "kind": "voice" }` | Verify account/model access and available voice IDs. |

Keep the approved voice ID explicit. Do not use a different voice if verification
returns another default. Model selection belongs to the configured provider;
compare it with the manifest's `expectedModel` instead of sending a model override.

Check titles (80 characters), tagged scripts (1,000 characters), spoken text
(220 characters), valid balanced tags, families and profiles against the existing
shared contracts. Voice duration is measured after synthesis, not guaranteed by
text length. Do not trim or accelerate speech to pass the 10-second limit.

## Submit and observe

1. Submit `POST /api/animation/production/jobs` with one batch's `inputs`.
   The backend permits 1–9 inputs; honor a requested smaller batch size.
2. Keep returned `jobId` values. The resource ID is `generated-<jobId>`.
3. Poll `GET /api/animation/production?include=<comma-separated-jobIds>` with
   at most nine IDs per request. Use bounded waits and retain pending IDs when
   the observation window expires; polling timeout does not authorize a new job.
4. Inspect `GET /api/animation/resources/<resourceId>` for each result.
5. Fetch `GET /api/animation/resources/<resourceId>/audio`, verify HTTP status,
   MIME, byte size and SHA-256 against resource metadata. Decoding without
   playback can validate audio duration. Do not claim acoustic approval from
   metadata or an HTTP response alone.

Each submission is atomic for its own database inserts; multiple batches are
not one transaction. The existing worker performs provider calls sequentially.
It stores the prepared MP3 in `production/<jobId>.mp3` under its configured
catalog directory. It records duration, checksum, provenance and voice metadata.
Successful registration yields job `published` and resource `active`/`ready`
with automatic eligibility. Do not introduce an extra approval/publish workflow.

## Recovery

| Observed state | Next action |
| --- | --- |
| `queued` / `generating` | Keep polling the same IDs. |
| `published` | Verify the existing resource and file; count as reused when already present before this execution. |
| `ready_for_review` with registration error | Retry `POST /api/animation/production/<jobId>/register` once; this does not call ElevenLabs. Report persistent failure. |
| `publishing` | Wait and recheck; do not race the worker. |
| `failed` / `uncertain` / `cancelled` | Preserve evidence and report; do not increment revision or retry synthesis automatically. |
| Submission response lost | Inspect existing jobs using the preserved request. An identical submission reuses its generation key; first resolve current state. |

Deduplication includes canonical configuration and room, not just spoken text.
Titles, tags, modes and revisions can affect identity. Check semantic duplicates
in the catalog before requesting genuinely new variants. A changed script needs
an explicitly approved new version rather than editing generated spoken text.

## Source of truth

- [Production API](../../../../server/Animation/router.ts)
- [Queue, provider execution and registration](../../../../server/Animation/Production.ts)
- [Audio preparation](../../../../server/Animation/AudioPreparation.ts)
- [Generation identity](../../../../server/Animation/generationKey.ts)
- [Resource metadata](../../../../server/Animation/Resources.ts)
- [Input contracts](../../../../shared/catalogProduction.ts)
- [Voice tag validation](../../../../shared/audioTags.ts)
