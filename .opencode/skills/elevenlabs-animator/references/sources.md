# Sources and verification scope

Reviewed on 2026-10-27 using official ElevenLabs documentation and Context7's
`/websites/elevenlabs_io` index. These links support the summaries in this skill;
they are not proof of a particular account's access or the quality of a generated
Alejandro Duran clip. No paid synthesis was used to write this skill.

1. **Prompting Eleven v4 / Best practices**
   https://elevenlabs.io/docs/overview/capabilities/text-to-speech/best-practices#prompting-eleven-v4
   Supports open-ended audio tags, emotional/vocal directions, sound cues,
   punctuation, accent experiments and voice-dependent results. The same page's
   IPA section documents slash-delimited pronunciation and v4 TTS examples.

2. **Text-to-Speech playground FAQ**
   https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech
   Confirms v3/v4 bracket tags, Create/Stream Speech use with `eleven_v4`,
   Text to Dialogue alternatives, Stability/Similarity, optional PVC Clone
   Strength in the provider UI, and no v4 Style/Speed sliders or SSML.

3. **Models**
   https://elevenlabs.io/docs/overview/models
   Documents `eleven_v4`, 90+ languages, the 10,000-character model limit,
   multi-speaker dialogue and the distinct real-time `eleven_v4_turbo` variant.

4. **Pauses and SSML phonemes FAQ**
   https://elevenlabs.io/docs/help-center/technical/do-pauses-and-ssml-phoneme-tags-work-with-the-api
   Explicitly excludes v4/v3 from SSML break support and points to native v4 IPA.

5. **Voice settings example**
   https://elevenlabs.io/docs/eleven-api/guides/how-to/websockets/realtime-tts
   Shows Stability/Similarity settings. Do not infer that this project's HTTP
   adapter implements WebSockets or every option available in other model families.

If sources differ in emphasis (for example, the model overview highlights Text
to Dialogue while the FAQ and prompting examples also document Text to Speech),
consult the concrete endpoint/model example rather than assuming exclusivity.

The tag lists here are illustrative. Natural-language directions such as a
particular character or accent are experiments, not guaranteed deterministic
effects. Use a real listening check when the user asks to generate a production clip.
