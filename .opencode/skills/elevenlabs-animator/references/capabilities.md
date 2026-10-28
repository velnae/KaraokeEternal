# Eleven v4: expressive audio capabilities

Documentation snapshot: 2026-10-27. This is an original operational summary,
not a complete vendor specification. Consult [sources](sources.md) when changing
integration behavior. Audio tags form an open descriptive vocabulary: there is
no finite list that can honestly be called every supported tag.

## Capability map

| Capability | Eleven v4 | This project |
| --- | --- | --- |
| Emotion and delivery | Bracket instructions at the relevant point in a script | Accepted and highlighted in the voice editor |
| Non-verbal reactions | Laughter, sighs, breathing and other vocal cues | Included in the generated clip, within its duration limit |
| Sound cues inside speech | Certain sound-effect tags are documented | Possible, but use a separate effect resource when independent control is required |
| Rhythm and emphasis | Punctuation, capitalization, pauses and text structure | Preserved in the tagged script; actual timing is measured after generation |
| Accent and character | Voice choice and descriptive tags can guide delivery | Alejandro Duran is the default; a regional accent is not certified by `es` alone |
| Pronunciation | Native IPA enclosed in forward slashes | No dedicated IPA/display-text authoring workflow; see pronunciation caveat below |
| Multilingual speech | The model family documents 90+ languages | ElevenLabs animator generation currently sends `language_code: es` |
| Multi-speaker dialogue | Text to Dialogue supports per-input speaker voices | Not implemented in this single-voice generator |
| Long-form content | Provider model limit documented as 10,000 characters | Local limit remains 10 seconds for animator voice |
| Voice cloning | Provider supports voice-library/cloning workflows | This app selects an available voice ID; it does not create or clone voices |
| Real-time variant | `eleven_v4_turbo` is a separate real-time model | Not the default; do not switch to it implicitly |

## Tag syntax and placement

Place a short direction immediately before the part it changes:

```text
[warmly] Bienvenidos a Il Gatto. [excited] ¡La siguiente canción puede ser la tuya!
```

Place reactions where the sound should occur:

```text
Qué buena noche para compartir. [laughs] ¡Seguimos con la música!
```

Use one or two directions for a short welcome. More tags do not automatically
mean better acting: excessive changes compete for the clip's time and intent.
Do not wrap spoken dialogue in brackets; bracket content is an instruction.

The project accepts balanced, non-nested tags of 1–120 characters, without
line breaks inside the brackets. Both `[excited]` and descriptive instructions
such as `[con voz cálida]` fit the syntax. Acceptance by the application is not
a promise of a particular acoustic result.

## Documented families and useful examples

### Emotion and attitude

| Intent | Example directions |
| --- | --- |
| Warmth | `[warmly]`, `[reassuring]` |
| Excitement and joy | `[excited]`, `[happy]`, `[cheerfully]`, `[delighted]` |
| Curiosity and surprise | `[curious]`, `[surprised]`, `[impressed]` |
| Thoughtfulness or sadness | `[thoughtful]`, `[sad]`, `[crying]` |
| Stronger attitude | `[angry]`, `[sarcastic]`, `[mischievously]` |

These examples appear in the official guide/FAQ and its sample scripts. They
are suggestions, not an API enum. For Il Gatto, prefer warmth and controlled
excitement; dramatic anger or sarcasm is rarely appropriate for a welcome.

### Delivery, pace and character

- `[whispers]` / `[whispering]`: quiet vocal delivery.
- `[shouts]` / `[shouting]`: louder or projected delivery, not a substitute for
  setting playback volume.
- `[sings]` / descriptive singing directions: a vocal performance cue, not a
  guarantee of melody, meter or a complete music track.
- `[short pause]`, `[long pause]`, `[pause]`: qualitative pacing instructions;
  they do not specify an exact millisecond pause.
- Descriptive combinations such as `[low, steady voice]` or
  `[warm, conversational tone]`: more explicit performance direction.
- `[strong X accent]`: documented experimental pattern; replace X with the
  desired accent. Do not add it by default when the selected voice already fits.

Descriptions of tiredness, playfulness or a character voice can be tried as
custom directions. Do not claim every translated label shown in a vendor UI
has an identical guaranteed effect in every API voice.

### Vocal reactions

Useful documented examples include:

```text
[laughs] [laughs harder] [starts laughing] [chuckles]
[clears throat] [sighs] [exhales] [exhales sharply]
[inhales deeply] [snorts] [wheezing]
```

Use reactions as part of a natural phrase rather than adding a disconnected
noise to every announcement. Laughter, breathing and pauses contribute to the
measured clip duration even when they add no spoken words.

### Sound effects

The guide documents `[applause]`, `[clapping]`, `[swallows]`, `[gulps]` and
other sound cues, including dramatic effects. Their inclusion here documents
capability, not a recommendation to use every cue in a restaurant.

Be explicit: a tag can be interpreted as delivery or as an effect. Prefer
`[low, gravelly voice]` over an ambiguous sound description when directing speech.
For reusable applause, transitions or background ambience, choose the separate
effect/ambience workflow. Those resources use `eleven_text_to_sound_v2`, not the
speech model; explain the desired sound in ordinary descriptive text.

## Punctuation and structure

- Exclamation marks support energy without requiring shouting.
- Ellipses can add a natural pause or anticipation; keep them sparse in short clips.
- Capitalization can emphasize a word; avoid full sentences in capitals.
- Sentence boundaries and paragraphs influence rhythm. The voice-script path
  preserves paragraph structure rather than flattening it indiscriminately.

Do not promise precise timing from punctuation or pause tags. The prepared file
is the authority for duration. If a clip is too long, shorten its wording or
reduce reactions instead of trimming speech or accelerating the result.

## Pronunciation and voice settings

Eleven v4 documents native IPA wrapped in forward slashes, for example
`/IPA_transcription/`. IPA is distinct from bracket emotion tags. It requires a
correct transcription and listening with the chosen voice.

The current application removes square-bracket directions from public display,
but does not independently rewrite slash-delimited IPA. Prefer ordinary readable
spelling for a public welcome. Do not insert phonetic notation into a public
message without addressing that display behavior.

The provider documents Stability and Similarity controls. Its interface can
also expose Clone Strength for compatible Professional Voice Clones. The local
adapter currently sends stability `0.5` and similarity boost `0.75`; it does not
implement Clone Strength editing. Do not invent a payload field for that slider.

Eleven v4 does not provide the Style or Speed sliders described for some older
models, and does not support SSML. Do not send `<break>` or XML phoneme tags.
The project's removed Interpretation selector must not be reintroduced as an
implicit emotion prefix: the operator's script is the explicit direction.

## API shape used here

The current single-speaker adapter uses the documented Text to Speech convert
endpoint with `eleven_v4`. Text to Dialogue is another provider capability,
not a reason to rewrite this working adapter without a concrete requirement.

```json
{
  "text": "[warmly] ¡Bienvenidos a Il Gatto!",
  "model_id": "eleven_v4",
  "language_code": "es",
  "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }
}
```

The voice ID belongs in `/v1/text-to-speech/{voice_id}`. Credentials stay on the
server. Verify model and voice availability with the configured account before
generation; a model's general capabilities do not establish that account's access.
