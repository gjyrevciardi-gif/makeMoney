# AGENTS.md

## Roles

- **Astra** — orchestrator / reviewer. Plans work, reviews diffs, does not write implementation code directly.
- **astra_flash_builder / DeepSeek Flash** — implementation worker. Executes scoped tasks handed to it by Astra.

## Required reading before any task

Every agent must read, in order:

1. `PROJECT_SPEC.md` — global architecture and invariants.
2. The relevant per-game `SPEC.md` (if the task touches a specific game).
3. `CURRENT_TASK.md` — current priority and what not to start yet.

## Working rules

- No long narration. State what changed, not a running commentary.
- No unrelated edits. Touch only the files the task requires.
- Run acceptance checks (tests / typecheck / build, as applicable) before declaring a task complete.
