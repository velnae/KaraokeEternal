---
name: promote-resources
description: "Trigger: subir recursos a prod, pasar configuraciones al VPS, promover dev a prod. Publish selected tested resources through a resumable API CLI."
license: Apache-2.0
metadata:
  author: "Karaoke Eternal"
  version: "1.1"
---

# Promote Resources

## Activation Contract

Use for comparing or publishing tested audio, backgrounds, birthday settings,
name pronunciations and listening introductions
between environments. Load [the workflow](../../../../docs/resource-promotion.md).

## Hard Rules

- Require an explicit production request before production reads or publication.
  Resolve both rooms and exact scope; ask one question if ambiguous.
- Use the CLI and authenticated APIs. Never copy SQLite, `.env`, credentials,
  orders, events, histories or runtime playback state.
- Keep bundles under ignored `.atl/promotions/`. Keep private session exports
  outside bundles, filter by environment, and remove exports in `finally`.
- Explain that valid audio uploads become automatically eligible; an active
  animator may use them. Do not request playback or change playback controls.
- For names and “para escuchar” introductions, use `resources:promote:calls`.
  Copy original WAV/MP3 pairs and bindings; never regenerate approved voices.
- Preserve fingerprints, files and receipts across retries. Report partial
  completion; never bypass drift, failed preparations or uncertain responses.

## Decision Gates

| Request | Action |
| --- | --- |
| Compare only | Run `plan`; stop before `apply`. |
| Publish selected scope | Plan, inspect differences, apply that fingerprint. |
| Interrupted run | Reuse its bundle and run the same `apply`. |
| Changed scope or target configuration | Reconcile partial results, then create a new plan. |

## Execution Steps

1. Confirm rooms and backend availability; birthday imports require the
   accompanying backend release. Export existing authenticated admin sessions.
2. Write an explicitly scoped manifest. Use resource IDs for selections; use
   `all` only when requested. Enable configuration sections only as authorized.
3. Run `npm run resources:promote -- plan MANIFEST BUNDLE` under Node 24.22.2.
   Inspect resource actions and source/target settings in `plan.json`.
   Use the calls companion for names/listening introductions and inspect every
   replacement. Resolve “today” from audio creation dates in `America/Lima`.
4. For publication, run `apply PLAN --confirm FINGERPRINT`. Reuse the receipt
   on recovery. Check mapped IDs, files and effective settings.
5. Inspect the affected HTTPS interface when available. Distinguish this smoke
   check from CLI integrity checks and actual public playback.

## Output Contract

Return destination/room, created or reused IDs, configuration sections, receipt
path, actual verification and failed/pending items. Never expose authentication.

## References

- [Workflow and recovery](../../../../docs/resource-promotion.md)
- [CLI](../../../../config/promote-resources.js)
