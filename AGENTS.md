# Project instructions

## UI and UX — required skill

For every task that creates or changes UI/UX (layout, styling, interaction,
controls, loading/empty/error states, or accessibility), load and follow the
Anthropic `frontend-design` skill **before editing the interface**:

- Skill: `.opencode/skills/frontend-design/SKILL.md`
- Provenance: `.opencode/skills/frontend-design/SOURCE.md`

Reuse the existing karaoke theme, components and application structure. Define
the visual hierarchy and interaction states first; then implement and inspect
screenshots at mobile and desktop sizes. Preserve Spanish UI copy and use
English identifiers and technical comments.

Do not leave primary actions disabled without a visible explanation and a next
step. Distinguish requesting an announcement from authorizing public playback:
waiting for audio preparation must not silently prevent a valid pending request.

Verify changed flows with Playwright, including keyboard use and responsive
layouts. For player/audio lifecycle changes, test both development (React
StrictMode) and production. Report actual checks and any untested behavior.

Keep the vendored skill unchanged; document project conventions here.
