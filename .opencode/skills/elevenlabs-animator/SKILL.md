---
name: elevenlabs-animator
description: "Trigger: ElevenLabs v4, audio tags, emociones, voz del animador, bienvenida Il Gatto. Draft expressive karaoke audio using project defaults."
license: ISC
metadata:
  author: "velnae"
  version: "1.0"
---

# ElevenLabs Animator

## Activation Contract

Use for expressive animator scripts, Eleven v4 audio tags, voice generation,
and Il Gatto catalog guidance. Do not apply to unrelated UI or client greetings.

## Hard Rules

- Read the local capability and workflow references before drafting or integrating.
- Default to Alejandro Duran (`sKgg4MPUDBy69X7iv3fA`), `eleven_v4`, Spanish `es`.
  Verify account availability for generation; never silently substitute a voice.
- Write neutral Spanish scripts with a warm, moderately energetic venue tone.
- Preserve explicit tags; do not prepend hidden emotions or add an interpretation
  selector. Use bracket directions, not HTML or SSML.
- Treat tag examples as guidance, not an exhaustive enum or guaranteed performance.
- Respect project limits: 1,000 script characters, 220 spoken characters and
  10 seconds of actual voice audio. Never silently trim or accelerate a clip.
- A suggestion is text only. Invoke synthesis only when generation is requested;
  never enable the animator or broadcast as a side effect.
- Keep tags out of public display and semantic repetition comparisons, but in
  synthesis/cache identity. Preview must not count as public usage.

## Decision Gates

| Need | Action |
| --- | --- |
| Spoken emotion or vocal reaction | Use a short, contextual voice tag. |
| Independently reusable effect/ambience | Use its resource type and Sound Effects adapter. |
| Exact pronunciation | Consult IPA guidance; check the public display implications. |
| Dialogue, long audio or another language | Distinguish provider capability from project support. |
| Variation | Change wording; tag-only changes do not create new semantic content. |

## Execution Steps

1. Identify purpose, resource type, message and intended energy.
2. Draft concise wording; normally use one or two deliberate tags.
3. Check syntax and project limits; leave duration explicitly unmeasured until rendered.
4. Set usage and profiles appropriate to the content. Use `welcome` for arrival.
5. For generation, follow the existing authenticated workflow and inspect the
   resulting audio. Report actual success/failure without inventing quality results.
6. Recheck official documentation through Context7 if changing an API/model contract.

## Output Contract

Return a title, copy-ready tagged script, voice, usage/profile recommendation and
an estimated duration clearly distinguished from measured duration. State whether
audio was actually generated. Keep technical explanations out of the spoken text.

## References

- [Capabilities and tag families](references/capabilities.md)
- [Project workflow and constraints](references/project-workflow.md)
- [Official-source provenance](references/sources.md)
- [Il Gatto welcome script](assets/welcome-il-gatto.txt)
- [Matching generation payload](assets/welcome-il-gatto.json)
