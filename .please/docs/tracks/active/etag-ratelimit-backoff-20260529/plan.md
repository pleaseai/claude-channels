# Plan: ETag Conditional Requests & Rate-Limit-Aware Backoff

> Track: etag-ratelimit-backoff-20260529
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: etag-ratelimit-backoff-20260529
- **Issue**: #11
- **Created**: 2026-05-29
- **Approach**: Manual `@octokit/rest` integration — capture/send ETag ourselves
  for (a); drive (b) from a separate `GET /rate_limit` poll + `Retry-After`. No new
  runtime dependencies.

## Purpose

Make the GitHub poll loop REST-efficient: turn "no new comments" polls into
quota-free `304` responses, and replace exception-only exponential backoff with
backoff that respects GitHub's own rate-limit signals — without changing which
comments the bridge delivers.

## Context

All work is in the single file `plugins/github/server.ts` plus its sibling
`server.test.ts`. Relevant existing seams:

- `RepoCursor` (~L95) — currently `{ since?: string }`; persisted per repo inside
  `PollCursor.repos`. `loadCursor` (~L340) passes `raw.repos` through verbatim, so
  an added `etag` field round-trips with **no loader change**.
- `GitHubClientLike` (~L116) — the mock seam. `listCommentsForRepo` currently
  returns only `{ data }` and takes no `headers`. It must expose response `headers`
  (for `etag`) and accept a request `headers` (for `if-none-match`). A
  `rest.rateLimit.get` method is added for (b).
- `pollRepo` (~L486) — pure-ish, takes the client; where conditional requests + 304
  handling land.
- `tick()` (~L688) + `backoffDelay` (~L253) — the poll loop and its backoff; where
  proactive pause + `Retry-After` land.
- State IO (`writeJsonAtomic`, ~L329) — atomic tmp+rename; cursor (incl. etag) keeps
  using it.
- Config: `resolvePollInterval` (~L247) is the pattern for new env vars.
- Tests: `mockClient()` (~L53) builds a `GitHubClientLike`; helpers are exported and
  unit-tested directly (no network).

## Architecture Decision

**(a) ETag — manual capture/send (chosen over make-fetch-happen).** A spike
(`poc/etag-make-fetch-happen/`) proved make-fetch-happen gives transparent 304s on
Bun but adds ~100 transitive deps (violating the self-contained single-file plugin
convention) **and** hides `x-ratelimit-*` headers on 304s. We instead store the
`ETag` from each poll in `RepoCursor.etag` and send it as `If-None-Match`.
`@octokit/rest` **throws** a `RequestError` with `status: 304` on Not-Modified, so
304 is handled in a `try/catch` around the list call — not a normal return.

**(b) Rate-limit — independent of poll-response headers.** Because 304s hide the
rate-limit headers (PoC finding), proactive backoff cannot read them off the poll
response. Instead `tick()` periodically calls `GET /rate_limit` (which itself does
**not** consume core quota) and pauses comment polling while `core.remaining <=`
threshold, until `core.reset`. Reactive `Retry-After` handling on 429 / secondary
limits is layered on top in the poll error path.

This keeps `@octokit/rest`; `octokit.js`/GitHub App migration is a separate future
track (out of scope).

## Architecture Diagram

```
tick() loop
  ├─ throttle gate ──────────────────────────────────────────────┐
  │   every N ticks: client.rest.rateLimit.get()                  │
  │   shouldPauseForRateLimit(core.remaining, threshold)?         │
  │     yes → schedule next tick at core.reset, skip polling ─────┤
  │     no  → continue                                            │
  ▼                                                               │
  for each repo: pollRepo(client, ref, cursor[repo])              │
     ├─ send If-None-Match: cursor.etag                           │
     ├─ 200 → process comments, cursor.etag = res.headers.etag    │
     └─ catch RequestError                                        │
          ├─ status 304 → no new items, keep etag, advance since  │
          └─ 429/secondary (Retry-After) → throw up to tick() ────┤
  ▼                                                               │
  catch in tick(): retryAfterDelay(err) ?? backoffDelay(...) ─────┘
```

## Tasks

- [x] T001 [P] Reintroduce `RepoCursor.etag` field and verify cursor round-trip persistence (file: plugins/github/server.ts)
- [x] T002 Extend `GitHubClientLike`: `listCommentsForRepo` accepts request `headers` and returns response `headers`; add `rest.rateLimit.get`; update `mockClient` accordingly (file: plugins/github/server.ts) (depends on T001)
- [x] T003 Conditional poll + 304 handling in `pollRepo`: send `If-None-Match`, capture `etag`, treat `RequestError` status 304 as no-new-items (keep etag, advance `since`) (file: plugins/github/server.ts) (depends on T002)
- [ ] T004 [P] Add pure rate-limit helpers: `resolveRateLimitThreshold`, `shouldPauseForRateLimit`, `retryAfterDelay` (file: plugins/github/server.ts)
- [ ] T005 Proactive rate-limit pause in `tick()`: periodic `rateLimit.get`, pause comment polling until `core.reset` when remaining ≤ threshold (file: plugins/github/server.ts) (depends on T002) (depends on T004)
- [ ] T006 Honor `Retry-After` on 429 / secondary-rate-limit responses in the `tick()`/`pollRepo` error path (file: plugins/github/server.ts) (depends on T004)
- [ ] T007 [P] Wire new env vars (`CLAUDE_GITHUB_RATELIMIT_THRESHOLD`, `CLAUDE_GITHUB_RATELIMIT_POLL_EVERY`) with defaults; update startup config help text + plugin INSTRUCTIONS/docs (file: plugins/github/server.ts)
- [ ] T008 Regression verification: confirm unchanged comment-delivery behavior; `bun test plugins/github/`, `turbo check`, `bun run lint` green (file: plugins/github/server.test.ts) (depends on T003) (depends on T005) (depends on T006)

## Dependencies

```
T001 ─┐
       └─> T002 ─> T003 ─┐
T004 ──────┬─> T005 ─────┼─> T008
           └─> T006 ─────┘
T007 (independent)
```

Parallel-capable at start: T001, T004, T007. T002 waits on T001; T003 on T002;
T005 on T002+T004; T006 on T004; T008 on T003+T005+T006.

## Key Files

- `plugins/github/server.ts` — all production changes (cursor type, client seam,
  pollRepo, tick, helpers, config, instructions).
- `plugins/github/server.test.ts` — all new tests (mockClient extension, 304 path,
  rate-limit helpers + pause, Retry-After).
- `poc/etag-make-fetch-happen/` — reference spike justifying the approach (not
  shipped into the plugin).

## Verification

- `bun test plugins/github/` — all tests pass, including new 304 + rate-limit cases.
- `turbo check` — build + typecheck clean (interface changes type-check).
- `bun run lint` — @antfu/eslint-config clean.
- No new entries in `plugins/github/package.json` dependencies.
- Manual sanity (optional): point the plugin at a low-traffic repo and confirm
  stderr shows 304/no-change polls and a proactive pause when quota is forced low.

## Test Scenarios

### T001
- Happy: cursor with `{ since, etag }` → `saveCursor` then `loadCursor` → both fields preserved (extends existing "persists and reloads cursor" test).
- Edge: legacy cursor file without `etag` → loads as `{ since }`, `etag` undefined, no crash.

### T002
- Test expectation: none — structural interface + mock extension; behavior is exercised by T003/T005 tests. (Verified indirectly via typecheck + dependent tests.)

### T003
- Happy (200): `pollRepo` with `cursor.etag` set → request carries `if-none-match`; response `headers.etag` is stored into the returned cursor; comments processed as today.
- Happy (304): `listCommentsForRepo` throws `{ status: 304 }` → returned cursor keeps the prior `etag`, advances `since`, and `emit` is **not** called (zero comments processed).
- Edge: first poll with no stored `etag` → no `if-none-match` header sent; normal 200 path stores the new etag.
- Error: non-304 error (e.g. 500) → propagates to caller (tick handles backoff); cursor unchanged.

### T004
- Happy: `shouldPauseForRateLimit(remaining=10, threshold=50)` → true; `(remaining=200, threshold=50)` → false.
- Edge: `resolveRateLimitThreshold` parses env int, falls back to default on missing/invalid (mirror `resolvePollInterval` tests); boundary `remaining === threshold` → pause.
- Happy: `retryAfterDelay` reads `retry-after` seconds header → ms; absent header → undefined.

### T005
- Happy: rate-limit reports `core.remaining` ≤ threshold with a future `reset` → `tick` skips `pollRepo` and schedules the next tick at/after `reset`.
- Happy: remaining above threshold → polling proceeds normally.
- Edge: `rateLimit.get` only invoked every N ticks (not every tick) — verify cadence.
- Error: `rateLimit.get` itself fails → non-fatal, polling continues (fail-open), warning on stderr.

### T006
- Happy: poll throws a 429 with `retry-after: 30` → next tick delay ≥ 30_000ms (overrides plain `backoffDelay`).
- Edge: secondary-rate-limit error without `retry-after` → falls back to `backoffDelay`.

### T007
- Test expectation: none — config/env wiring + doc/help-text strings. Defaults are exercised through T004's `resolveRateLimitThreshold` test; startup help text is non-behavioral.

### T008
- Integration: replay a fixed comment timeline through `pollRepo` across 200→304→200 sequence and assert the delivered comment set equals the pre-change behavior (SC-5).
- Happy: full `bun test plugins/github/` suite green; `turbo check` + `bun run lint` green (SC-6).

## Progress

_(updated during /please:implement)_

## Decision Log

- **2026-05-29** — (a) via manual ETag hook over make-fetch-happen: deps weight +
  self-contained convention + 304 hides rate-limit headers (PoC). User-confirmed.
- **2026-05-29** — (b) driven by `GET /rate_limit` + `Retry-After`, not per-poll
  headers, because 304 responses omit `x-ratelimit-*` (PoC finding).
- **2026-05-29** — Keep `@octokit/rest`; defer `octokit.js`/GitHub App to a separate
  track.

## Surprises & Discoveries

- `loadCursor` passes `repos` through verbatim → `RepoCursor.etag` needs no loader
  change to persist (only the type + write sites matter).
- `@octokit/rest` signals 304 by **throwing** `RequestError(304)`, so the 304 path
  is a catch branch, not a normal return — tests must throw from the mock.
