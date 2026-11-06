---
name: animator-catalog-batch
description: "Trigger: lotes de audios, batch del animador. Produce approved animator clips through the existing authenticated catalog API."
license: Apache-2.0
metadata:
  author: "Karaoke Eternal"
  version: "1.0"
---

# Animator Catalog Batch

## Activation Contract

Use for preparing, executing or resuming approved animator catalog batches.
Load [elevenlabs-animator](../elevenlabs-animator/SKILL.md) and the
[workflow](references/workflow.md) before execution.

## Hard Rules

- Require approved scripts and an explicit generation request; drafting alone
  does not authorize synthesis. Preserve approved wording and emotion tags.
- Use the authenticated application API over the project HTTPS URL. Let its
  worker own ElevenLabs calls, SQLite writes and audio preparation.
- Confirm the target room and exact voice. Never expose credentials, silently
  substitute voices, change playback controls or request public playback.
- Explain before submission that valid results become automatically eligible
  in the catalog; there is no separate manual publishing step.
- Preserve payloads, revisions and returned job IDs. Never change inputs to
  bypass deduplication or automatically repeat uncertain provider calls.

## Decision Gates

| Situation | Action |
| --- | --- |
| Text-only request | Prepare the manifest; do not submit. |
| Existing matching job | Inspect and resume its state; do not regenerate. |
| Registration failed after generation | Use the existing register operation. |
| Failed, uncertain, or configuration mismatch | Report the affected item and stop submission until resolved. |

## Execution Steps

1. Read the approved manifest. Expand defaults into each item and preserve its
   batch boundaries; the API accepts at most nine inputs per request.
2. Follow workflow preflight: room, catalog, provider, voice, model, processor
   and configured remaining capacity. Reuse the application's validation rules.
3. Persist the execution intent locally, then submit one batch. Immediately
   record returned job IDs before polling. Complete that batch before the next.
4. Follow jobs to terminal state. Verify each resource's room, script, family,
   profiles, voice, readiness and measured duration against the manifest.
5. Fetch prepared audio through HTTPS and verify its bytes/checksum. Record a
   receipt under ignored `.atl/audio-batches/`; previews are not public usage.

## Output Contract

Return created/reused/failed/pending counts, item names, measured durations,
resource IDs, receipt location and actual checks. Distinguish file validation
from listening quality. Report partial completion without calling it success.

## References

- [Workflow and recovery](references/workflow.md)
- [Approved first batch / manifest example](assets/general-voices-01.json)
