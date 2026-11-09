# Birthday personalization

Birthday profiles select writing directions and a saved speech identity before
generation. The existing approval, next queue slot and audiovisual sequence remain
the playback authority.

## Configure

1. Open **Ajustes → Cumpleaños**. Existing installations retain ElevenLabs;
   new configurations default to Gemini text and Gemini Flash TTS.
2. Consult voices, select a default and load/edit the five initial age profiles.
   Candidate voice names are suggestions, not evidence of availability or accent.
   Listen to each chosen profile before use. Switching provider clears unsaved
   voice assignments rather than interpreting one provider's IDs as another's.
3. Set writing directions, delivery, permitted approaches and historical frequency
   (`0` disables history; default `4`). Save settings.
4. Prepare a birthday with name, sex, birth year and optional public dedication.
   Advanced options override approach or voice profile. Preview before approval.

Age is computed for the celebration year in Lima. Resolution is exact age/sex,
then age/any-sex, then the default profile. Sex does not require a same-sex narrator.
The greeting targets 25 seconds; measured audio must satisfy the saved maximum
(up to 60 seconds). The prompt reserves words for dedication and history.

## Content and identity

- `personalizationJSON` freezes profile, approach, speech provider/model/voice/style,
  recent anonymized openings and the source/version of the selected reference.
- The historical catalogue in `server/Birthdays/personalization.ts` starts with
  source-reviewed NASA/CERN events and truthful era variants. Exact-year links
  require an exact match. Missing references produce a normal greeting.
- A birth-linked historical phrase is intentionally public and can make age or
  birth year inferable. Raw demographic fields remain absent from public DTOs.
- The server appends the verified historical clause and authorized dedication
  literally. The model writes the creative portion without duplicating those
  clauses. This prevents fabricated/reworded factual clauses from being trusted.
- Optional dedications are limited to 160 characters and validated as public
  content. Table numbers are supported; direct demographic disclosure is not.
- Three approaches rotate deterministically. An identical recent opening is
  rejected before speech generation; regeneration is explicit, not a paid loop.
- **Actualizar solo la voz** retains the transcript and regenerates audio from
  current saved voice settings. Editing content regenerates text and audio.
  Retries retain their snapshot. **Probar voz Flash-Lite** explicitly changes the
  speech model and requires another preview. Nothing is scheduled by these actions.
- Existing prepared files and legacy event snapshots remain valid. No migration
  synthesizes audio or changes a queued event's voice.

Gemini uses server-side `KES_GEMINI_API_KEY`, a configurable text model, and a
saved TTS model. Speech uses the existing `GeminiGreetingTts` transport with clean
transcript and separate `speech_metadata.style`. Model and catalogue voice access
are checked before synthesis. The birthday worker reports failures explicitly.

## Verification

```sh
npm test -- shared/birthdays.test.ts server/Birthdays server/Greetings/GeminiGreetingTts.test.ts
npm run typecheck
node config/birthdays.e2e.mjs
KARAOKE_E2E_MODE=development node config/birthdays.e2e.mjs
KARAOKE_E2E_LEGACY_BIRTHDAY=1 node config/birthdays.e2e.mjs
```

Build server/client targets before production E2E. E2E uses temporary databases,
real media preparation/playback, and fixture text/TTS providers. The HTTPS option
targets **dev-karaoke.puyu.pe**, checks tunnel availability, then routes worktree
HTML/assets/API/socket to the isolated server. It validates browser HTTPS behavior,
not deployment of this branch to the shared development service.

| Criteria | Evidence |
| --- | --- |
| D01–D02 age profiles and precedence | `personalization.test.ts`, shared birthday tests |
| D03 literal transcript and separate delivery | `gemini.test.ts`, E2E provider assertions |
| D04 prompt and fixed-intro separation | Prompt assertions and content validation |
| D05 variety and duplicate rejection | Unit tests; no synthesis for duplicate openings |
| D06 public dedication and table numbers | Validator tests and form E2E |
| D07 exact-year/era facts and no-match behavior | Source URLs, snapshot and unit/E2E assertions |
| D08 private DTO allowlist | Public-projection and socket E2E checks |
| D09 selective regeneration and stable retries | Store/worker tests and operator revoice E2E |
| D10 legacy compatibility | Legacy-row tests and legacy E2E mode |
| D11 responsive/keyboard controls | Desktop/mobile screenshots; Enter submit/save; overrides |
| D12 playback and recovery | Development/production E2E, original socket/audio tests |
| D13 real voice quality | Pending an authorized audition with actual account voices |

Provider fixtures do not establish pronunciation, regional accent, creativity,
real account availability or exact cost. Use fictional difficult names and
multiple age profiles for the final acoustic check before public playback.
