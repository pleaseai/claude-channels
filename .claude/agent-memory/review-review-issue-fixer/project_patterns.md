---
name: Project fix patterns
description: Patterns for auto-fixing review issues in claude-channel-slack — test reimplementation signatures, doc accuracy
type: project
---

Production `isInBoundThread(msg)` and `dedup(ts)` in server.ts close over module-scope state (`boundThreadTs`, `recentInboundTs`, `RECENT_INBOUND_CAP = 200`). Test reimplementations must mirror this closure pattern — use factory functions (`makeIsInBoundThread`, `makeDedup`) that close over a local Set/variable.

**Why:** server.ts has module-level side effects (reads .env, connects to Slack) so it cannot be imported in tests. Test reimplementations must match production signatures exactly or they test themselves.

**How to apply:** When fixing test signature mismatches for module-scope-closure functions, introduce a factory function in the test file that returns the closure, then call the factory per test to get an isolated instance.

Pre-existing TypeScript errors exist in `apps/docs/` (Nuxt globals `defineNuxtConfig`, `defineAppConfig` unknown to plain tsc). These are not regressions — ignore them when validating plugin changes with `npx tsc --noEmit`.

`chunk(text, MAX_CHUNK_LIMIT, 'length')` does a hard character-limit cut (mode `'length'`), not natural break points. Documentation must reflect this exactly.
