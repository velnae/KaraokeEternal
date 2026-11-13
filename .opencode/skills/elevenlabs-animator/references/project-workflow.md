# KaraokeEternal workflow and constraints

Read this alongside [capabilities](capabilities.md). Prefer current source code
and the user's latest decisions over the older design draft's superseded review,
microphone and consumption-panel proposals.

## Defaults and limits

| Item | Current project behavior |
| --- | --- |
| Speech model | `eleven_v4`, configurable on the server |
| Default voice | Alejandro Duran, `sKgg4MPUDBy69X7iv3fA` |
| Language | API code `es`; the voice determines regional character |
| Voice-script size | 1,000 total characters; at most 220 spoken characters after stripping tags |
| Tag syntax | Balanced, non-nested brackets; 1–120 characters per tag; no newline inside a tag |
| Actual voice duration | At most 10 seconds |
| Supporting effects | Short effects: at most 4.5 seconds. Musical transitions: at most 12 seconds, used automatically after presentations. Independent playback clipping is deferred. |
| Pause ambience | Local uploads/replacements: at most 35 seconds; ElevenLabs generation: at most 30 seconds per request |
| Uploads | MP3, WAV or OGG, at most 20 MB; actual media is validated |
| Profiles | `dinner` (Cena), `mixed` (Mixto), `party` (Fiesta) |
| Availability | Automatic after technical preparation; no manual publication requirement |

The server may explicitly override the preferred voice. The UI does not silently
switch to another voice if the preferred one is missing from the account: choose
an available alternative explicitly or add the desired voice to the account.

The provider's 10,000-character model allowance is not the local voice-script
limit. An estimated duration is not a successful validation of a rendered file.

## Drafting for Il Gatto

1. Identify the event: welcome, next turn, closing, invitation, celebration,
   goodbye, booth cue or promotion. Do not turn every clip into a generic welcome.
2. Use short, readable Spanish with the requested venue name. Start from the
   supplied welcome asset when appropriate, not from an unreviewed third-party slogan.
3. Suggest one or two emotions aligned with that event. Warm plus excited is
   usually enough for a welcome. Avoid pretending to see, hear or know an event
   that the application did not receive.
4. Recommend `welcome` for the welcome resource; choose compatible room profiles.
   Promotions require expiry. Do not create birthdays or personalized greetings
   without their actual context.
5. Create genuinely different wording for variants. Changing tags alone does
   not create fresh semantic content for the scheduler's non-repetition rules.

## Existing UI workflow

- Open **Ajustes → Animador → Audios → Voz del animador**.
- Select **Generar audio**, enter name/script, choose **Bienvenida** for this
  example, and verify the preferred voice.
- **Etiquetas de voz** offers optional suggestions; custom bracket instructions
  remain valid. There is no extra Interpretation or ElevenLabs language picker.
- Generate only when the user requested synthesis. A valid result becomes
  **Disponible**. If generation fails, use the reported reason; do not blindly retry.
- Use the play icon for local listening. It uses the current browser output,
  not the venue player; the app does not physically route headphones/speakers.
- Listen for the venue name, accent, warmth, intelligibility, duration and tag
  execution. This is a quality check, not a mandatory publication gate.

A draft/suggestion task stops at copy-ready text. Do not call the provider,
start a jornada, enable the animator or send an announcement as a side effect.

## What stays separate

- **Script**: raw words and performance directions sent to generation.
- **Public text**: bracket directions removed; do not render them as dialogue.
- **Generation identity**: tags remain significant because they can change audio.
- **Semantic repetition**: equivalent spoken wording remains equivalent even
  when its tags change.
- **Preview**: local review, excluded from public usage statistics.
- **Public use**: confirmed starts recorded by the authoritative player, scoped
  by room and Lima commercial day. Interrupted confirmed speech still counts.

Never restore the removed microphone-state control, credit dashboard or manual
Approve/Publish workflow when following older notes. Client free-form greetings
and local TTS are a different feature; this skill does not authorize client-supplied
engine instructions or substitute ElevenLabs for local personalized TTS.

## Source map

- [Tag defaults, parsing and suggestions](../../../../shared/audioTags.ts)
- [Generation contracts](../../../../shared/catalogProduction.ts)
- [Validation and generation pipeline](../../../../server/Animation/Production.ts)
- [ElevenLabs adapter](../../../../server/AudioProviders/ElevenLabs.ts)
- [Common audio preparation](../../../../server/Animation/AudioPreparation.ts)
- [Editor](../../../../src/components/Animation/AudioTagEditor.tsx)
- [Generator form](../../../../src/components/Animation/AudioResourceForm.tsx)
- [Usage ledger](../../../../server/Animation/usage.ts)
- [Operating guide](../../../../docs/ANIMATION-PHASE-2.md)
- [Catalog architecture](../../../../docs/ANIMATOR-CATALOG.md)

For integration changes, run appropriate focused tests and the project's dev/prod
audio E2E checks. For skill/documentation-only edits, verify frontmatter, local
references, example syntax and limits; do not launch paid synthesis as validation.
