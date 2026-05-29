# Plan: GitHub App + Webhook + Cloudflare Tunnel Transport

> Track: github-app-webhook-20260530
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: /please:plan
- **Track**: github-app-webhook-20260530
- **Issue**: (pending)
- **Created**: 2026-05-30
- **Approach**: Opt-in second inbound transport in the existing single-file `server.ts`, sharing the current inbound pipeline (mention → gating → dedup → emit) and outbound cores via the injectable `GitHubClientLike`.

## Purpose

Give the GitHub channel a real-time, push-based inbound path (GitHub App + webhook over a Cloudflare tunnel) as an opt-in alternative to PAT polling, without disturbing existing poll users.

## Context

The plugin is a single self-contained `server.ts` (~846 LOC). Inbound today: `runServer` builds an `Octokit` from a PAT and runs a `tick()` poll loop calling `pollRepo`, which filters comments through `mentionsHandle` → self-author check → `isAllowed` (access.json) → `Dedup` → `emit` (a `notifications/claude/channel` notification whose meta comes from `buildChannelMeta`). Outbound tools (`replyCore`/`reactCore`/`editCore`/`fetchCore`) already accept a `GitHubClientLike`, so they are transport-agnostic. State lives under `~/.claude/channels/github/`; logging is stderr-only (stdout is the MCP stdio transport).

The webhook transport reuses every gating/dedup/emit primitive above. New surface area is: transport selection, GitHub App auth (installation token), a signed HTTP receiver, a `cloudflared` subprocess, and one webhook-URL registration call.

## Architecture Decision

**One file, two inbound transports, one shared core.** `CLAUDE_GITHUB_TRANSPORT` selects `poll` (default) or `webhook`. The webhook path produces the same `GitHubMessage` objects the poll path produces, then hands them to the identical mention/gating/dedup/`emit` sequence — so inbound semantics and the emitted `<channel>` event are provably equivalent across transports. Outbound is unchanged: in webhook mode the injected client is an App-installation-authed Octokit instead of a PAT Octokit.

New logic is split into **pure, exported helpers** (transport resolve, signature verify, event→message map, tunnel-URL parse, App-credential parse) that mirror the existing unit-testable helper style, plus a thin **impure orchestration** layer (`Bun.serve` receiver, `cloudflared` spawn, webhook registration) wired only inside `runServer`'s webhook branch.

Rejected: extracting modules / new package (violates the documented single-file plugin convention, NFR-4); replacing polling (breaking, loses the no-public-URL fallback); bundling `cloudflared` (treated as a host prerequisite per Assumptions).

## Architecture Diagram

```
                       ┌──────────────── poll transport (default, unchanged) ───────────────┐
CLAUDE_GITHUB_TRANSPORT │  PAT Octokit → tick()/pollRepo → [mention→gating→dedup] → emit     │
  = poll | webhook  ───►├────────────────────────────────────────────────────────────────────┤
                       │  webhook transport (new, opt-in)                                     │
                       │                                                                       │
   GitHub ──issue_comment webhook POST──► cloudflared tunnel ──► Bun.serve receiver            │
                       │      (quick *.trycloudflare.com | named)        │                     │
                       │                                                 ▼                     │
                       │                            verifyWebhookSignature (X-Hub-Signature-256)│
                       │                                                 │ ok                  │
                       │                            messageFromIssueCommentEvent → GitHubMessage│
                       │                                                 ▼                     │
                       │                    [ mentionsHandle → isAllowed → Dedup ] ──► emit ───┘
                       │                                                                       │
   startup: App auth (installation token) ──► register tunnel URL as App webhook (Octokit)
```

## Tasks

- [x] T001 [P] Add `@octokit/auth-app` dep (file: plugins/github/package.json) — _node:crypto used for signatures instead of @octokit/webhooks; see Decision Log_
- [x] T002 [P] Add `resolveTransport(raw)` selector — `poll`|`webhook`, default `poll` (file: plugins/github/server.ts)
- [x] T003 [P] Add App-credential config parse/validate: app id, private key, installation id, webhook secret from env (file: plugins/github/server.ts)
- [x] T004 Add App-installation Octokit factory via `@octokit/auth-app`, returning a `GitHubClientLike` (file: plugins/github/server.ts) (depends on T001, T003)
- [x] T005 [P] Add `verifyWebhookSignature(secret, signatureHeader, rawBody)` (HMAC-SHA256, constant-time compare) (file: plugins/github/server.ts) (depends on T001)
- [x] T006 [P] Add `messageFromIssueCommentEvent(payload)` → `GitHubMessage | null` (issue + PR conversation comments; ignore non-`created` actions) (file: plugins/github/server.ts)
- [x] T007 Add `Bun.serve` webhook receiver wiring verify → map → shared `[mention→gating→dedup→emit]` pipeline (file: plugins/github/server.ts) (depends on T005, T006)
- [x] T008 [P] Add `parseTunnelUrl(line)` — extract `https://*.trycloudflare.com` (and named hostname) from cloudflared output (file: plugins/github/server.ts)
- [x] T009 Add cloudflared subprocess lifecycle: spawn quick + named modes, detect ready URL, monitor, clean shutdown (file: plugins/github/server.ts) (depends on T008)
- [x] T010 Add webhook-URL auto-registration via App Octokit on startup (file: plugins/github/server.ts) (depends on T004, T009)
- [x] T011 Wire webhook transport branch into `runServer` (poll remains default; assemble App client + receiver + tunnel + registration) (file: plugins/github/server.ts) (depends on T002, T004, T007, T009, T010)
- [x] T012 [P] Update tech-stack.md GitHub row to note webhook/App transport (file: .please/docs/knowledge/tech-stack.md)
- [x] T013 [P] Document webhook setup: App creation, credentials, transport env, cloudflared prereq (files: plugins/github/README.md, plugins/github/README.ko.md, plugins/github/skills/configure/SKILL.md)

## Dependencies

```
T001 ─┬─► T004 ──┐
T003 ─┘          │
T002 ────────────┤
T005 ─┐          │
T006 ─┴► T007 ───┼─► T011
T008 ──► T009 ───┤
        T004,T009 ► T010 ─┘
T012, T013  (independent docs — [P])
```

Phase grouping (checkpoint between each):
- **Phase 1 — Foundation**: T001, T002, T003, T004
- **Phase 2 — Webhook inbound**: T005, T006, T007
- **Phase 3 — Tunnel & registration**: T008, T009, T010
- **Phase 4 — Integration & docs**: T011, T012, T013

## Key Files

- `plugins/github/server.ts` — all new transport logic (helpers + `runServer` branch); existing `pollRepo`, `mentionsHandle`, `isAllowed`, `Dedup`, `buildChannelMeta`, `emit`, and tool cores are reused unchanged.
- `plugins/github/server.test.ts` — add unit suites for each new pure helper; extend the MCP-stdio integration test for webhook-mode startup with a stub.
- `plugins/github/package.json` — new `@octokit/*` deps.
- `plugins/github/README.md`, `README.ko.md`, `skills/configure/SKILL.md` — setup docs.
- `.please/docs/knowledge/tech-stack.md` — transport note.

## Verification

- `bun test plugins/github/` — all existing + new unit/integration tests pass.
- `bun run lint` and `turbo check` — clean (ESLint + typecheck).
- Coverage >80% for new code (`bun test --coverage`).
- Manual: with `CLAUDE_GITHUB_TRANSPORT` unset, behavior is unchanged (poll). With `webhook` + valid App creds + cloudflared present, an `@mention` comment is delivered in real time; a forged-signature POST is rejected.

## Test Scenarios

### T001
Test expectation: none -- dependency manifest change; exercised transitively by T004/T005.

### T002
- Happy: `"webhook"` → `'webhook'`; `"poll"` → `'poll'`.
- Edge: unset/`undefined` → `'poll'`; mixed case `"Webhook"` → `'webhook'` (document chosen case policy).
- Error: unknown value `"socket"` → `'poll'` (safe fallback) and a stderr warning.

### T003
- Happy: all four values present → typed config object.
- Edge: multiline PEM private key round-trips intact (escaped `\n` handling).
- Error: missing app id / private key / installation id / webhook secret in webhook mode → descriptive error listing the missing keys.

### T004
- Happy: factory returns a client whose `rest.issues.createComment` is callable (auth strategy wired); installation id passed through.
- Error: invalid private key surfaces a clear startup error (mock auth throwing).
- Integration: returned client satisfies `GitHubClientLike` so `replyCore`/`reactCore`/`editCore`/`fetchCore` accept it (type + smoke call via mock).

### T005
- Happy: signature computed from the same secret+body verifies true.
- Edge: body with unicode/newlines verifies correctly (raw bytes, not re-serialized JSON).
- Error: wrong secret → false; missing/malformed `sha256=` header → false; length-mismatch never throws (constant-time compare guard).

### T006
- Happy: `issue_comment.created` on an issue → `GitHubMessage` with correct repo/issueNumber/commentId/user/commentType=`issue`; on a PR → `commentType=pr`.
- Edge: payload missing optional user id → userId defaults (parity with poll's `?? 0`).
- Error: `action` ∈ {edited, deleted} → `null`; non-issue_comment shape → `null`.

### T007
- Happy: signed POST of a mentioning, allowlisted, non-self `issue_comment` → exactly one `emit` with meta equal to the poll path for the same comment (AC-6).
- Edge: duplicate delivery (same comment id) → deduped to one emit; comment not mentioning the handle → no emit; HTTP 2xx returned to GitHub regardless so it does not retry valid-but-ignored events.
- Error: bad signature → no emit, 401; non-webhook path / wrong method → 404/405; stdout never written (stderr-only).

### T008
- Happy: a real cloudflared quick-tunnel log line yields `https://<x>.trycloudflare.com`.
- Edge: named-tunnel hostname line parsed; URL appears mid-stream among other log lines.
- Error: lines with no URL → `null` (caller keeps waiting); malformed URL not returned.

### T009
- Happy: spawn (mocked child process) emits a URL line → lifecycle resolves with the parsed URL; quick vs named chooses correct args.
- Edge: URL arrives after several non-URL lines → still resolved; shutdown signal terminates the child.
- Error: child exits before emitting a URL / readiness timeout → rejects with a clear error (startup fails loudly, FR-10).

### T010
- Happy: registration calls the App webhook-update endpoint (mock Octokit) with the current tunnel URL + secret; correct path appended.
- Edge: re-registration with an identical URL is idempotent (no spurious error).
- Error: API failure surfaces a clear startup error; secret is never logged.

### T011
- Happy: `CLAUDE_GITHUB_TRANSPORT=webhook` assembles App client + receiver + tunnel + registration and does NOT start the poll loop; unset starts the poll loop only.
- Edge: webhook mode missing cloudflared / creds → fails fast with actionable stderr.
- Integration: MCP-stdio spawn test in webhook mode reaches "listening/registered" with stubbed tunnel + Octokit, without opening a real tunnel.

### T012
Test expectation: none -- documentation.

### T013
Test expectation: none -- documentation.

## Progress

_(updated by /please:implement)_

## Decision Log

- **Single file retained** despite `server.ts` exceeding the 500-LOC default — the project's single-file plugin convention is explicit and spec NFR-4 locks it. Flag for a future split discussion if the file becomes unwieldy.
- **`issue_comment` only** for parity with current polling; PR review comments and issue/PR-opened mentions deferred (spec Out of Scope).
- **cloudflared is a host prerequisite**, spawned as a subprocess, not bundled.
- **App auth replaces PAT only in webhook mode**; poll mode keeps PAT.
- **Dependency deviation (T001)**: added only `@octokit/auth-app` (App JWT/installation-token auth is non-trivial — use the official lib). Dropped the planned `@octokit/webhooks`: signature verification uses `node:crypto` HMAC-SHA256 + `timingSafeEqual`, and webhook payloads use a minimal in-file structural interface — consistent with the existing `RawComment`/`GitHubClientLike` typing style and the project's minimal-dependency, single-file convention.

## Surprises & Discoveries

- **`@octokit/auth-app` is route-aware**: a single installation-authed Octokit
  signs `/app/*` routes (webhook registration) with the App JWT and repo routes
  with the installation token — so one client serves both outbound tools and
  `registerWebhookUrl`. No separate JWT client needed.
- **Coverage**: 94% functions / ~76% lines for `server.ts`. All new *domain*
  logic (transport selector, App config, signature verify, event→message map,
  receiver handler, tunnel parse/lifecycle, registration, `startWebhookTransport`
  orchestration) is unit-tested. The line-coverage dip vs the prior 80.7% is the
  enlarged `runServer` bootstrap (poll loop + webhook assembly), an impure shell
  that is integration-level by nature; it is covered partially by the MCP-stdio
  spawn tests (poll init + webhook fail-fast on missing creds). Not gamed.
- **Pre-existing unrelated failure**: `plugins/slack/server.test.ts`
  ("requires CLAUDE_SLACK_CHANNEL_ID") fails in this environment independent of
  this track (reproduces with these changes stashed). Left untouched (out of
  scope); flagged for separate triage.
- **Stray file mode**: `plugins/slack/server.ts` picked up an executable bit
  (100644→100755) during the run (tooling side effect); reverted.
- **Named-tunnel readiness** is detected from cloudflared's
  "Registered tunnel connection" log line (no URL is printed); the public URL is
  the configured hostname. Quick tunnels parse the `*.trycloudflare.com` URL.

## Progress

- Review fixes (2 IMPORTANT findings from /please:review): webhook body-size cap (413, DoS guard) + post-startup cloudflared liveness monitoring (onTunnelDown → log + exit for supervisor restart). Tests added; 116 pass.

## Outcomes & Retrospective

### What Was Shipped
An opt-in `CLAUDE_GITHUB_TRANSPORT=webhook` transport for the GitHub channel: GitHub App installation auth, an HMAC-verified `Bun.serve` webhook receiver for `issue_comment` events reusing the poll pipeline (mention → gating → dedup → emit), a `cloudflared` quick/named tunnel lifecycle with post-startup liveness monitoring, and automatic webhook-URL registration. Poll + PAT remains the default (non-breaking). 13 tasks, 116 tests.

### What Went Well
- Pure-helper + injectable-seam factoring made nearly all new logic unit-testable (94% funcs) without real network/subprocess/ports.
- Reusing the existing inbound pipeline gave provable cross-transport parity (AC-6 meta test).
- Independent review surfaced two real robustness/security gaps (body-size DoS, silent tunnel death) that were fixed + tested.

### What Could Improve
- `runServer` is now large; line coverage (~76%) is dragged by this impure bootstrap. A future tidy could extract poll/webhook setup into thinner testable units.
- Webhook happy-path is only covered at unit/seam level + fail-fast integration; a full stubbed end-to-end stdio test was deferred.

### Tech Debt Created
- No full end-to-end webhook integration test (cloudflared + real signed delivery). Manual verification still required for the live path.
- `server.ts` size continues to grow under the single-file convention — revisit if it becomes unwieldy.
