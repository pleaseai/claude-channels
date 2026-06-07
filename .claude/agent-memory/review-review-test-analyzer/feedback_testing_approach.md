---
name: Testing approach for server.ts plugins
description: The plugin test suite uses source-text inspection (Bun.file().text()) for integration behavior and pure-function reimplementations for unit logic. This pattern has known gaps.
type: feedback
---

The `server.test.ts` pattern uses two strategies:
1. Pure function reimplementations in the test file (chunk, isInBoundThread, dedup, safeFileName)
2. Source-text string matching (source.toContain(...)) for behaviors that require a live Slack connection

**Why:** server.ts executes at module scope (connects to Slack at import time), making it impossible to import and call directly in tests without real credentials.

**How to apply:** When evaluating test gaps, distinguish between "testable with pure reimplementation" vs "requires source inspection" vs "requires real integration test". Flag when a source-inspection test could give false confidence (e.g., it checks that a string exists in source but not that the logic is correct). Flag when a reimplemented function diverges from the actual implementation.

Key gap: the test `dedup` reimplementation takes a `Set<string>` parameter, but `server.ts` `dedup()` uses a module-scope closed-over `Set` with no parameter — they have different signatures. The test is testing a different function from what's in production.
