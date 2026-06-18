---
product_spec_domain: plugins/github
---

# GitHub App + Webhook + Cloudflare Tunnel Transport

> Track: github-app-webhook-20260530

## Overview

The GitHub channel plugin (`plugins/github/server.ts`) currently bridges issue/PR
`@mention` comments into a Claude Code session via a fine-grained **PAT** and
**`@octokit/rest` REST polling**. Polling is the only inbound transport: a local
subprocess has no public URL, so it repeatedly queries the REST API (with ETag
conditional requests and rate-limit-aware backoff).

This track adds a **real-time, webhook-based inbound transport** as an **opt-in
alternative** to polling. When enabled, the channel authenticates as a **GitHub
App**, runs a local HTTP webhook receiver, exposes it to GitHub through a
**Cloudflare tunnel** (ephemeral *quick* tunnel by default, or a persistent
*named* tunnel when configured), auto-registers the public URL as the App's
webhook target, verifies inbound payload signatures, and feeds qualifying
`issue_comment` events through the **same** mention-matching, sender-gating,
dedup, and emit pipeline that polling already uses.

Polling with a PAT remains the **default**; existing users are unaffected unless
they explicitly opt into webhook mode.

## Goals

- Real-time inbound delivery of `@mention` comments without poll-interval latency.
- A clean, opt-in transport selector that leaves the existing poll path intact.
- Reuse — webhook and poll transports share one inbound pipeline (mention match →
  sender gating → dedup → emit) and one outbound path (`reply`/`react`/
  `edit_message`/`fetch_messages`).
- Zero-config local exposure via Cloudflare quick tunnel, with an upgrade path to
  a persistent named tunnel.

## Requirements

### Functional Requirements

- [ ] FR-1: **Transport selection.** A config/env switch (e.g.
  `CLAUDE_GITHUB_TRANSPORT=poll|webhook`) selects the inbound transport.
  Unset/invalid → `poll` (current behavior). Selecting `webhook` activates the
  GitHub App + webhook + tunnel path.
- [ ] FR-2: **GitHub App authentication.** In webhook mode, authenticate as a
  GitHub App using app id, private key, and installation id supplied via config
  (`~/.claude/channels/github/.env`). Installation tokens are obtained/refreshed
  for outbound REST calls (comment/react/edit) — replacing the PAT in this mode.
- [ ] FR-3: **Manual App provisioning.** The user creates the GitHub App in the
  GitHub UI and supplies credentials (app id, private key, installation id,
  webhook secret). The channel consumes them; it does **not** create the App.
  A `/github:configure`-style path documents the required values.
- [ ] FR-4: **Local webhook receiver.** Run a local HTTP server that accepts
  GitHub webhook POSTs on a dedicated path, independent of the MCP stdio
  transport (stdout stays reserved for MCP; logging stays on stderr).
- [ ] FR-5: **Signature verification.** Every inbound request is verified against
  the configured webhook secret (`X-Hub-Signature-256`, HMAC-SHA256). Requests
  with a missing, malformed, or mismatched signature are rejected (HTTP 401/400)
  and never enter the pipeline.
- [ ] FR-6: **Event handling — `issue_comment`.** Handle `issue_comment` events
  (covering both issue and PR conversation comments). Map each to the existing
  inbound pipeline: mention match (`mentionsHandle`), self-author filter,
  sender gating (`isAllowed`/`access.json`), dedup (`Dedup` by comment id), and
  `emit` as a `notifications/claude/channel` event with the same `<channel>`
  meta shape as poll mode. Non-`created` actions (edited/deleted) and non-matching
  events are ignored.
- [ ] FR-7: **Cloudflare tunnel — quick (default).** Spawn `cloudflared` to create
  an ephemeral TryCloudflare tunnel (no CF account), parse the assigned
  `https://*.trycloudflare.com` URL from its output, and route it to the local
  receiver.
- [ ] FR-8: **Cloudflare tunnel — named (configurable).** When named-tunnel config
  is supplied (CF account/credentials + hostname), run `cloudflared` against that
  named tunnel for a stable public URL instead of a quick tunnel.
- [ ] FR-9: **Webhook URL auto-registration.** On startup, after the tunnel URL is
  known, update the GitHub App's webhook config (URL + secret) via the GitHub API
  so ephemeral quick-tunnel URLs work with no manual step. The registered path
  matches the local receiver path.
- [ ] FR-10: **Tunnel lifecycle management.** The `cloudflared` subprocess is
  spawned, its readiness/URL detected, monitored while running, and terminated
  cleanly on channel shutdown. Startup fails loudly (stderr + non-zero exit or
  documented degradation) if the tunnel cannot be established.
- [ ] FR-11: **Outbound parity.** `reply`, `react`, `edit_message`, and
  `fetch_messages` work identically in webhook mode, authenticated via the App
  installation token, preserving outbound gating (`isWatchedRepo`).

### Non-functional Requirements

- [ ] NFR-1: **Non-breaking.** With `CLAUDE_GITHUB_TRANSPORT` unset, behavior is
  byte-for-byte the current poll path; no existing env var or state file meaning
  changes.
- [ ] NFR-2: **Security invariants preserved.** Sender gating on commenter login,
  outbound gating on watched repos, atomic state writes under
  `~/.claude/channels/github/`, secrets at mode `0600`, and stderr-only logging
  all hold in webhook mode. Webhook bodies are treated as untrusted input.
- [ ] NFR-3: **Testability.** Transport selection, signature verification, event→
  message mapping, tunnel-URL parsing, and webhook registration are unit-testable
  with mocked subprocess/HTTP/Octokit boundaries. Target >80% coverage for new code.
- [ ] NFR-4: **Single-file convention.** Implementation stays within the plugin's
  single-file `server.ts` pattern (no cross-plugin imports), consistent with the
  existing channel architecture.

## Acceptance Criteria

- [ ] AC-1: **Real-time delivery.** With webhook mode enabled and the tunnel up, an
  `@mention` comment on a watched issue/PR is delivered into the session promptly
  upon GitHub's webhook POST, with no dependence on the poll interval.
- [ ] AC-2: **Signature security.** A payload with a missing/forged/mismatched
  `X-Hub-Signature-256` is rejected and never emitted; a correctly signed payload
  is accepted. Sender + outbound gating decisions match poll mode for identical input.
- [ ] AC-3: **Non-breaking opt-in.** With `CLAUDE_GITHUB_TRANSPORT` unset (or
  `poll`), the existing polling behavior and all current tests pass unchanged;
  webhook code is dormant.
- [ ] AC-4: **Tunnel lifecycle.** Both quick and named tunnel modes produce a
  reachable public URL routed to the local receiver; the `cloudflared` process is
  cleaned up on shutdown; failure to establish a tunnel surfaces a clear error on
  stderr.
- [ ] AC-5: **Auto-registration.** On startup in webhook mode, the GitHub App's
  webhook URL is updated to the current tunnel URL via the API (verifiable via a
  mocked Octokit call in tests).
- [ ] AC-6: **Pipeline reuse.** An `issue_comment` webhook event and an equivalent
  polled comment produce the same emitted `<channel>` event (same meta keys/values
  for an identical comment).

## Out of Scope

- **Cloudflare deployment** — running the webhook receiver as a hosted Cloudflare
  Worker / Pages Function / container is explicitly **out of scope** for this
  track and recorded as a **future follow-up track**. This track targets local
  use (subprocess + tunnel) only.
- **Assisted GitHub App creation** (App Manifest flow / guided registration) — the
  user provisions the App manually and supplies credentials.
- **PR review (diff-line) comments** (`pull_request_review_comment`) and **issue/PR
  "opened" body mentions** (`issues` / `pull_request` events) — webhook handling is
  limited to `issue_comment` for parity with current polling. These are candidate
  future enhancements.
- **Webhook event types beyond comments** (labels, reviews, pushes, CI, etc.).
- **Migrating existing poll users** off PAT — PAT + polling remains a fully
  supported, default transport.

## Assumptions

- `cloudflared` is available on the host (installed by the user or documented as a
  prerequisite); the channel invokes it as an external subprocess rather than
  bundling it.
- The user can create a GitHub App and obtain its app id, private key, installation
  id, and webhook secret, and grant it Issues/Pull requests read-write on the
  watched repositories.
- The GitHub App has permission to update its own webhook configuration via the API
  (for FR-9 auto-registration).
- Quick (TryCloudflare) tunnels are acceptable for the default local-dev use case
  despite ephemeral URLs and no SLA; named tunnels cover the persistent case.
- `@octokit/auth-app` and `@octokit/webhooks` (or equivalent verified-signature
  handling) are acceptable new dependencies, consistent with the existing
  `@octokit/*` stack.
