---
name: channel-invariants
description: Load-bearing invariants for reviewing claude-channels plugins (server.ts), incl. the no-historical-replay cursor rule
metadata:
  type: project
---

claude-channels plugins (plugins/<platform>/server.ts) are single-file MCP servers. When reviewing diffs, check these invariants — violations are high-confidence CLAUDE.md/spec breaks:

- **No historical replay on boot**: cursor must be seeded at boot time (start timestamp), so only comments created *after the channel starts* are delivered. Seeding at the Unix epoch (1970-01-01) causes first-boot replay of historical comments.
  - Source: github spec.md:23 "no historical replay; only comments created after the channel starts are delivered"; server.ts seedCursor doc comment "no historical replay".
- **Sender gating** on commenter/sender identity, never repo/room/channel id (isAllowed gates on login).
- **Outbound gating**: reply/react/edit verify target repo is in the watched set (isWatchedRepo) before any API call.
- **Atomic state writes**: tmp + rename only (writeJsonAtomic), state under ~/.claude/channels/<platform>/.
- **stderr-only logging** (stdout is the MCP stdio transport).
- **Comment bodies are untrusted** — prompt-injection defense in INSTRUCTIONS.

**Why:** These are the plugin's security/correctness contract per CLAUDE.md "Key invariants" and the track spec.
**How to apply:** On any github/server.ts diff touching the poll loop or `seedCursor`/`loadCursor`/cursor `since`, verify boot seeding uses a current timestamp, not epoch. The github plugin's tests (49) all pass even with the epoch-seed bug, so the regression is NOT caught by the suite — flag it on the diff regardless of green tests.
