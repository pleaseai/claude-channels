# ETag Conditional Requests & Rate-Limit-Aware Backoff

> Track: etag-ratelimit-backoff-20260529
> Type: chore · Issue: #11 · Follow-up to #6 / PR #7

## Overview

The GitHub channel plugin (`plugins/github/server.ts`) polls watched repositories
for new issue/PR comments every ~5s using a `since` timestamp cursor, and applies a
generic exponential backoff (`backoffDelay`) on *any* poll exception. This is
REST-inefficient: every poll consumes primary rate-limit quota even when nothing
changed, and the backoff is blind to the server's own rate-limit signals.

This chore improves REST efficiency without changing any externally observable
bridge behavior, in two independent parts:

- **(a) Conditional requests** — store the `ETag` from each `listCommentsForRepo`
  response and send it back as `If-None-Match`. GitHub answers `304 Not Modified`
  when nothing changed; 304s do **not** count against the primary rate limit, so
  the common "no new comments" poll becomes quota-free.
- **(b) Rate-limit-aware backoff** — proactively pause polling before quota
  exhaustion using GitHub's rate-limit signals, and honor server-provided
  `Retry-After` timing on 429 / secondary-rate-limit responses, instead of the
  current exception-only exponential backoff.

### Approach decision (from this track's PoC — `poc/etag-make-fetch-happen/`)

A spike compared three approaches on Bun 1.3.14:

| Option | (a) ETag/304 | (b) rate-limit | Verdict |
| --- | --- | --- | --- |
| **1. Manual `octokit.hook.after`** | manual store + `If-None-Match` | manual header read | **CHOSEN** — zero new deps, fits self-contained convention |
| 2. `@octokit/plugin-throttling`+`retry` | ✗ (no ETag) | reactive only | conflicts with poll-loop backoff model |
| 3. `octokit.js` + `make-fetch-happen` | ✓ transparent | **✗ hides `x-ratelimit-*` on 304** | +~100 transitive deps; conflicts with single-file convention |

**Decision:** implement **(a) via the manual hook approach** — reintroduce
`RepoCursor.etag`, capture `ETag` and send `If-None-Match` ourselves, keep
`@octokit/rest`. No new runtime dependencies.

**Decisive PoC finding driving (b):** on a revalidated 304, the rate-limit
headers are absent from the response. Therefore **(b) must not depend on
per-poll response headers** — it is driven by a separate `GET /rate_limit`
call (which itself does not consume quota) plus `Retry-After` handling.

## Scope

In scope:

- Reintroduce `RepoCursor.etag` and persist it alongside `since` in the cursor file.
- Capture the `ETag` response header on each `listCommentsForRepo` poll and send it
  as `If-None-Match` on the next poll for that repo.
- Treat `304 Not Modified` as a clean "no new items" result: skip comment
  processing, advance the cursor timestamp, retain the existing ETag.
- Read rate-limit state via a periodic `GET /rate_limit` request and proactively
  pause polling when remaining core quota is at/below a configurable threshold,
  resuming after the reported reset time.
- Honor the `Retry-After` header on 429 / secondary-rate-limit responses.
- Make the proactive-pause threshold and the rate-limit poll cadence configurable
  via environment variables with sensible defaults.
- Unit tests covering the 304 path and the rate-limit backoff logic.

Out of scope:

- Migrating off `@octokit/rest` to `octokit.js`, and GitHub App authentication —
  orthogonal to #11 and deferred to a separate future track.
- Adopting `make-fetch-happen` or any new HTTP/caching dependency.
- Changing which comments are delivered, mention matching, dedup, access gating,
  or any outbound tool behavior.
- ETag/conditional requests for non-poll calls (reply/react/edit/getAuthenticated).

## Success Criteria

- [ ] SC-1: A poll against an unchanged repo issues an `If-None-Match` request and,
      on `304`, processes zero comments while still advancing the `since` cursor and
      retaining the stored ETag (verified by unit test with a mock client).
- [ ] SC-2: The stored ETag round-trips — it is persisted in the cursor file and
      reloaded across restarts, and is sent on the subsequent poll for that repo.
- [ ] SC-3: When `GET /rate_limit` reports remaining core quota at/below the
      configured threshold, the poller pauses and does not issue further comment
      polls until the reported reset time (verified by unit test).
- [ ] SC-4: A 429 / secondary-rate-limit response causes the next poll to be delayed
      by at least the server-provided `Retry-After` duration (verified by unit test).
- [ ] SC-5: Externally observable bridge behavior is unchanged — the set of comments
      delivered for a given timeline is identical to the pre-change behavior.
- [ ] SC-6: `bun test plugins/github/` passes; `turbo check` (build + typecheck) and
      `bun run lint` pass. New code keeps the plugin self-contained (no new runtime
      dependencies).

## Constraints

- **Client:** keep `@octokit/rest`; no new runtime dependencies (self-contained,
  single-file plugin convention per CLAUDE.md / product.md).
- **(b) data source:** proactive backoff is driven by `GET /rate_limit` + `Retry-After`,
  never by per-poll response headers (304s hide them — PoC finding).
- **No external behavior change:** purely a REST-efficiency change; comment delivery
  semantics stay identical.
- **Configurable:** proactive-pause quota threshold and rate-limit poll cadence are
  env-var configurable with sensible defaults (consistent with the existing
  `CLAUDE_GITHUB_POLL_INTERVAL_MS` pattern).
- **State writes:** cursor (incl. ETag) continues to be written atomically (tmp +
  rename) into `~/.claude/channels/github/`.
- **Testability:** new logic exercised through the existing `GitHubClientLike`
  mock-friendly seam; tests must not perform real network calls.

## Out of Scope

- `octokit.js` migration and GitHub App auth (future track).
- Conditional requests for non-polling API calls.
- Persisting rate-limit state across process restarts (in-memory is sufficient).
