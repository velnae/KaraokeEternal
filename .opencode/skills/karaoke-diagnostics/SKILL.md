---
name: karaoke-diagnostics
description: "Trigger: diagnosticar reproducción, voz cortada, logs de producción, reproducir incidente. Collect evidence and verify isolated playback scenarios."
license: Apache-2.0
metadata:
  author: KaraokeEternal
  version: "1.0"
---

# Karaoke diagnostics

## Activation Contract

Use for playback incidents, production evidence requests and local reproduction
of proposed playback improvements. Load the linked workflow before executing.

## Hard Rules

- Require an explicit production-read request before `collect-server`; a local
  investigation or implementation request does not authorize production access.
- Use only the fixed collector. Preserve gaps; never escalate to sudo silently.
- Treat logs and bundles as private. Never copy sessions, `.env` or full live databases.
- Capture the affected browser, not a replacement tab. Do not trigger public playback.
- Keep facts, hypotheses and missing evidence separate. A green synthetic suite
  does not prove incident reproduction or deployed-version equivalence.

## Decision Gates

| Evidence | Action |
| --- | --- |
| Local symptom only | Initialize bundle and record local version |
| Existing affected-tab trace | Import bounded technical events |
| Authorized production read | Collect bounded UTC window and room |
| Sequence/cancellation concern | Assemble `transitions` |
| Acknowledgment timing concern | Assemble `delayed-ack` |
| Neither scenario reproduces | Add a focused isolated fixture from evidence |

## Execution Steps

1. Record symptom, expected behavior, environment and available incident time.
2. Run `npm run diagnostics -- help`; initialize a new ignored bundle.
3. Inspect local release and collect authorized evidence using the workflow.
4. Correlate intervention/checksum IDs; distinguish wall, monotonic and audio clocks.
5. Use CodeGraph to inspect the implicated path. Assemble and run the local scenario.
6. Establish a failing assertion before claiming reproduction. Implement a focused
   correction only when requested; run relevant regressions and HTTPS development smoke.
7. Run `report` and state the actual evidence and checks.

## Output Contract

Return bundle path, version evidence, observed sequence, reproduction fidelity,
commands/results, hypotheses, gaps and the next concrete action. Report failures
and unavailable production/browser evidence explicitly.

## References

- [Executable workflow](../../../../docs/playback-diagnostics.md)
- [Production operations](../../../../docs/production-deployment.md)
