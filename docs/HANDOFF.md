# Karaoke MVP — General Handoff

## Purpose

This file gives a short orientation for a developer taking over the Karaoke MVP. It intentionally does not duplicate the implementation sequence.

For an agent-specific checklist, use `docs/CODEX-HANDOFF.md`.

## Repository context

- Product repository: `velnae/KaraokeEternal`.
- Working branch: `feature/karaoke-mvp`.
- Base branch: `main`.
- Original project: `bhj/KaraokeEternal`.

## Read before implementation

1. `docs/PRD-MVP.md`.
2. `docs/ARCHITECTURE.md`.
3. `docs/DECISIONS.md`.
4. `docs/IMPLEMENTATION-PLAN.md`.

`IMPLEMENTATION-PLAN.md` is the sole authority for phase order.

## Product summary

The product is a single-venue karaoke MVP built by extending Karaoke Eternal. Participants join a room by QR, use a guest alias, search local or YouTube tracks and submit requests. The operator controls approval, queue settings, house content and playback. One browser player per room outputs the content through the venue's existing setup.

The MVP is not a multi-tenant SaaS and is not offline-first.

## Core configurable rules

| Setting | Default | Values |
| --- | ---: | --- |
| Maximum pending participant requests | 2 | 1–20 |
| Songs per participant FAIR turn | 1 | 1–5 |
| House tracks between participant turns | 2 | 0–10 |
| Approval | AUTO | AUTO / MANUAL |
| Rotation | FAIR | FAIR / FIFO |

The exact semantics, fallbacks and change behavior are defined in `PRD-MVP.md` and `ARCHITECTURE.md`.

## Essential model

Queue items have:

- origin: `PARTICIPANT`, `HOUSE` or `OPERATOR`;
- source: `LOCAL` or `YOUTUBE`;
- persisted lifecycle status;
- a local song ID or external YouTube video ID;
- a metadata snapshot for display/history.

Only `PENDING_APPROVAL` and `APPROVED` participant items count toward the pending limit. Only `APPROVED` items are eligible for upcoming playback.

## Responsibility boundary

Backend:

- validates rooms, permissions and settings;
- persists queue items and lifecycle;
- enforces limits and approval;
- broadcasts authoritative state.

Active player:

- calculates FAIR/FIFO upcoming order;
- applies house interleaving;
- plays CDG, MP4 or YouTube;
- reports idempotent state transitions.

Do not move the full scheduler to the backend during MVP.

## Current code caveat

Queue Settings, shared validation/defaults and Phases 1–8 tests are implemented. Queue lifecycle, normalized metadata snapshots and pending counts are persisted in SQLite. Player status updates synchronize lifecycle idempotently, and terminal history is reconstructed after refresh/reconnect. AUTO/MANUAL approval, admin moderation, participant feedback, configurable FAIR/FIFO ordering, house interleaving, manually positioned operator items, local source resolution, YouTube search/request creation and IFrame playback are operational.

The next implementation phase is the operator UX and authorization audit. Inspect the live branch before relying on this summary.

## Definition of done

- Acceptance scenarios in `PRD-MVP.md` pass.
- Phase exit criteria in `IMPLEMENTATION-PLAN.md` pass.
- Local karaoke remains usable without YouTube.
- A YouTube failure does not break local playback.
- Room settings are validated and persisted.
- Player reconnect preserves played/pending states.
- New business rules have automated tests.
- No undocumented stack or scope expansion is introduced.
