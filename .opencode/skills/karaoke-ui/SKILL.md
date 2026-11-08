---
name: karaoke-ui
description: "Trigger: UI/UX, layout, controls, copy, help text, empty states, accessibility. Apply minimal, intuitive Karaoke Eternal interfaces."
license: Apache-2.0
metadata:
  author: "Karaoke Eternal"
  version: "1.0"
---

# Karaoke UI

## Activation Contract

Load alongside `frontend-design` before every project UI/UX change. Apply the
project rules in `AGENTS.md`; keep the upstream design skill unchanged.

## Hard Rules

- Prefer fewer elements, clear labels, and visual hierarchy over explanations.
- Do not add supporting text that repeats controls, exposes internal rules, or
  describes obvious behavior. If the action is understandable without it, omit it.
- Do not replace removed text with tooltips, badges, or help icons by default.
- Keep Spanish UI copy and the existing theme and components.
- Preserve accessible names, essential status feedback, and actionable error,
  blocking, and empty-state messages. Never leave a disabled primary action
  unexplained or without a next step.

## Decision Gates

| Situation | Action |
| --- | --- |
| Normal flow with usable results | Show controls and results; omit filter explanations. |
| A control needs an explanation | Improve its label or layout first. |
| Error, blocked action, or empty state | Show the shortest useful message and next step. |
| Text merely describes implementation | Remove it from the interface. |

## Execution Steps

1. Identify the user's action and the minimum elements needed to complete it.
2. Review each proposed sentence: remove redundant guidance before editing.
3. Implement the smallest change using existing patterns.
4. Verify the affected flow over HTTPS, including relevant keyboard behavior;
   inspect mobile and desktop screenshots for visual changes.
5. Follow the project's impact-based checks. Keep validation and error recovery
   working when removing explanatory copy.

## Output Contract

Briefly report the change, actual checks, and any blocker. Do not add unrelated
UI cleanup or commit without a request.

## References

- [Project instructions](../../../../AGENTS.md)
- [Frontend design](../frontend-design/SKILL.md)
