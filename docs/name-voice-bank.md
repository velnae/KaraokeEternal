# Manage reusable name pronunciations

**Animator → Names** manages one pronunciation bank for every room in this
installation. Development and production have independent banks.

## Quick path

1. Open **Animador → Nombres** as an administrator.
2. Create a pronunciation, such as `Yon`, and associate names such as
   `John`, `Jhon`, and `Ion`. An existing association must be explicitly reassigned.
3. Generate and privately listen to a candidate, then choose **Usar esta versión**.

The participant's displayed name is unchanged. The alias controls only which
approved pronunciation is used in listening presentations and greeting signatures.
Unknown names retain automatic preparation when generation is enabled.

## Versions and provider consumption

| Action | Result | Provider request |
| --- | --- | --- |
| Listen privately | Plays the stored MP3 in this browser | No |
| Edit or reassign aliases | Changes pronunciation lookup | No |
| Select a stored version | Updates compatible pending preparations | No |
| Reprocess level | Creates a locally normalized candidate | No |
| Generate or regenerate | Creates a new synthesis candidate | Yes |
| Archive | Stops new use while retaining files and history | No |

A candidate never replaces a selected version automatically. Failed or uncertain
generation preserves the usable audio and is not silently retried. Concurrent
automatic requests from different rooms share one persistent generation receipt.

Approved names remain reusable after a style/prompt edit when provider, model,
voice, and processing format remain compatible. The normal and Lite Gemini 3.8
TTS variants share the name bank; approved versions from either remain reusable.
Other models or different voices do not silently mix with the existing one.

New versions record the exact effective directions, voice, model, and recipe.
Imported versions retain their original timestamps and hashes. Directions that
were not recorded historically are shown as unknown rather than reconstructed.

The name recipe requests supported, clear announcement delivery. Local level
normalization is not a guarantee that a whispered performance becomes a clearly
spoken one. Real voice quality still requires listening to an explicitly generated
sample before selecting it.

### Global pronunciation model and style

Expand **Modelo y estilo de pronunciación (Gemini)** on the Names page. Choose
**Gemini 3.8 Flash TTS · Lite** (`gemini-3.8-flash-lite-tts`) or
**Gemini 3.8 Flash TTS · Normal** (`gemini-3.8-flash-tts`) and edit the complete
`speech_metadata.style` used for future name generations. Save both with
**Guardar configuración**. Saving these settings
does not create jobs, consume provider quota, regenerate the bank, or change
greeting/intro styles. Once saved, the name style is independent of the general
greeting direction. Existing selected recordings remain reusable.

**Cargar estilo predeterminado** loads the built-in direction into the draft;
**Guardar configuración** applies it. Unsaved edits can be discarded. Concurrent editors
use a revision check and a stale draft must reload before overwriting changes.
Queued generations and existing audio versions keep their captured model and
instructions; only newly submitted synthesis receives the newly saved settings.
Local reprocessing retains the original model and never requests new synthesis.
Model selection uses the same shared generation budget as greetings.

## Confirmed usage

**Usos completos** counts acknowledged completion of a public resource containing
that name version. It does not count preparation, downloads, private previews,
or an intro that stops before the name resource plays.

Usage follows immutable composition dependencies and deduplicates repeated
receipts. A completed name resource still counts when a later greeting is
interrupted. Older clients can confirm a complete sequence; historical backfill
requires both a completed intervention and a recorded start for the resource.
Earlier history can therefore be partial. Zero means no confirmed usage, not
proof that an old recording was never heard.

The bank and its usage ledger are global, without a room ownership dependency.
Closing/removing rooms, clearing musical history, restarting, and ordinary audio
cleanup do not expire name versions or their totals. A running sequence keeps its
original version; pending sequences resolve an updated alias/version again.

## Storage and migrations

- `namePronunciations` and `nameVoiceAliases`: global identity and manual mappings.
- `karaokeCallParts`: existing WAV/MP3 metadata plus name identity, selected version,
  and generation metadata. Global name parts have `roomId = NULL`; other kinds
  retain room ownership.
- `nameVoiceUses`: idempotent completed-resource receipts, retained independently
  of room and musical-history deletion.
- `listeningPresentations.namePartId`: immutable version binding once playback starts.

Files remain under `<data>/animation/calls/masters` and `production`.
Migrations 047/048 preserve existing IDs, checksums, references, and paid recordings.
The referenced-table rebuild is atomic, checks foreign keys before commit, and
restores enforcement on success or failure. Do not edit an applied migration.

## Verification

Run checks with Node **24.22.2**:

```sh
mise exec node@24.22.2 -- npm test -- server/Animation/Calls/NameBank.test.ts
mise exec node@24.22.2 -- npm run typecheck
mise exec node@24.22.2 -- env KARAOKE_E2E_MODE=development KARAOKE_E2E_HTTPS_UI=1 npm run test:animation:names
```

The focused browser suite uses temporary data, a fake provider, private preview,
and actual cross-room playback. It covers alias reassignment, candidate selection,
uncertain generation, free local reprocessing, confirmed usage, archival, keyboard,
and mobile/desktop layouts. Use the full calls playback suite for singing/listening
coexistence and normal/near-end-seek regression checks. Production-mode tests run
against an isolated local build, not the VPS.

## Design acceptance checklist

- [x] C01. One compatible pronunciation is reused across two rooms without new synthesis.
- [x] C02. Names, versions, and usage survive cleanup, restart, archival, and room removal.
- [x] C03. Populated legacy migration preserves IDs/hashes/references, repeats safely, and rolls back invalid foreign keys.
- [x] C04. John/Jhon/Ion resolve to Yon while the participant's visible name is preserved.
- [x] C05. Alias conflicts require explicit reassignment; case/Unicode normalization preserves accent distinctions and moderation.
- [x] C06. Concurrent preparation shares a persistent generation receipt; queue backpressure does not abort other rooms.
- [x] C07. A candidate, provider failure, or uncertain result does not silently replace selected audio.
- [x] C08. Pending preparations follow a new choice; started playback and its displayed preview retain their pinned version.
- [x] C09. Alias-based signatures retain attribution and legitimate sender-change cancellation.
- [x] C10. UI search/sort, aliases, generation date, last usage, counts, playback, versions, regeneration, and archival work.
- [x] C11. Private listening, alias edits, stored selection, reprocessing, and local assembly do not synthesize voice.
- [x] C12. Only completed named resources count; duplicate receipts and interrupted intros do not inflate usage.
- [x] C13. Historical backfill requires evidence and imported coverage is identified as partial.
- [x] C14. New synthesis records its effective directions; style edits preserve approved compatible recordings.
- [ ] C15. Auditory approval of an explicitly generated real-provider sample remains a venue/user check; synthetic tones do not prove vocal quality.
- [x] C16. Global administrative access and room playback permissions remain separate, including raw source-audio protection.
- [x] C17. Keyboard/focus behavior and 390/1440-pixel screenshots have been verified without horizontal overflow.
- [x] C18. Node 24.22.2 focused checks, HTTPS StrictMode UI, and isolated production playback checks pass.
