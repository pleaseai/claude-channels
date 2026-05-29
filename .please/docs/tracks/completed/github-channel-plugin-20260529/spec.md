# GitHub Channel Plugin — Specification

## Overview

Two-way channel plugin connecting GitHub issue/pull-request conversations to Claude Code via REST API polling. Runs locally with no public URL required (GitHub webhooks cannot reach a local subprocess, so the plugin polls the GitHub REST API the same way the Telegram/Discord channels poll their platforms). Implements the Claude Code Channels protocol as an MCP server.

Inbound events are **@mention comments**: comments on issues/PRs in allowlisted repositories that mention the configured handle. Outbound is posting/reacting/editing comments back on the originating thread. Authentication uses a fine-grained **Personal Access Token (PAT)**.

## Design Decisions

- **Inbound definition**: @mention comments on issues/PRs in watched repositories (chosen over the broader Notifications API and all-comments approaches to minimize noise while matching the Slack mention pattern).
- **Authentication**: fine-grained Personal Access Token (single-user/small-team simplicity, mirrors the Slack `.env` token pattern; can reuse a `gh` CLI token).
- **Inbound delivery**: REST polling (a local MCP subprocess cannot receive GitHub webhooks without a public URL/tunnel).

## Functional Requirements

### FR-001: GitHub REST Connection

- Authenticate with a fine-grained PAT (`CLAUDE_GITHUB_TOKEN`)
- Resolve the authenticated account (`GET /user`) at startup to determine the bot/self login for mention detection and self-message filtering
- Watch a configured set of repositories (`CLAUDE_GITHUB_REPOS=owner/repo,owner/repo`)

### FR-002: Inbound Messaging (@mention detection)

- Poll watched repositories for new issue and pull-request comments
- Emit only comments whose body mentions the configured handle (`CLAUDE_GITHUB_MENTION`, default = authenticated login)
- Forward as `notifications/claude/channel` with metadata: `chat_id` (`owner/repo#number`), `message_id` (comment id), `user` (commenter login), `user_id`, `ts` (ISO), `url` (comment html_url), `repo`, `issue_number`, `comment_type` (`issue` | `pr_review` | `pr`)
- Deduplicate by comment id; persist a last-seen cursor across polls

### FR-003: Sender Access Control

- Maintain a sender allowlist in `~/.claude/channels/github/access.json`
- Gate on the commenter's GitHub login (sender identity), never the repo/issue id
- Policy modes: `allowlist` (default) | `open`; support a static snapshot at boot
- Bootstrap by adding logins directly (no platform DM-pairing equivalent on GitHub)

### FR-004: Outbound Messaging (reply tool)

- Post a comment back to the originating issue/PR thread (resolved from `chat_id`)
- Outbound gating: verify the target repository is in the watched/allowlisted set before sending
- Markdown body; chunk when a single comment would exceed GitHub's ~65,536-char body limit

### FR-005: Message Operations

- `react` — add a reaction (`+1`, `-1`, `heart`, `eyes`, `rocket`, `hooray`, `confused`, `laugh`) to a comment or issue/PR
- `edit_message` — edit a comment the plugin previously posted
- `fetch_messages` — fetch recent comments from a given issue/PR thread (oldest-first, with comment ids)

### FR-006: Polling Efficiency & Rate Limits

- Use conditional requests (ETag / `If-None-Match`) and `since` cursors to avoid redundant fetches
- Honor `X-RateLimit-Remaining` / `X-RateLimit-Reset` and `Retry-After`; back off when throttled
- Configurable poll interval (`CLAUDE_GITHUB_POLL_INTERVAL_MS`, default 5000ms)

### FR-007: Access Management & Configure Skills

- `/github:access allow <login>` — add a sender to the allowlist
- `/github:access remove <login>` — remove a sender
- `/github:access policy <allowlist|open>` — set access policy
- `/github:access list` — show current policy and allowlist
- `/github:configure <token> [owner/repo,...]` — configure PAT and watched repos

### FR-008: Security

- PAT stored in `~/.claude/channels/github/.env` with `0o600` permissions
- Atomic writes (tmp + rename) for `access.json` and the poll cursor
- Treat all comment bodies as untrusted input; prompt-injection defense in the Claude `instructions` string
- Logging to stderr only (stdout is the MCP stdio transport)

## Non-Functional Requirements

- Single-file `plugins/github/server.ts` pattern (following the Slack reference implementation)
- No build step — direct Bun execution (`bun server.ts`)
- No public endpoints required
- Self-contained: no imports from other plugins

## Out of Scope

- GitHub App / installation-token authentication (PAT only for this track)
- Webhook ingestion (polling only)
- The broad GitHub Notifications API feed (mention-only inbound)
- Permission relay (`claude/channel/permission`) — may be a follow-up track

## Success Criteria

- [ ] Inbound @mention comments from watched repos arrive in the session as `<channel source="github">` events
- [ ] Sender gating blocks comments from logins not on the allowlist
- [ ] `reply` posts a comment to the correct issue/PR thread, with outbound gating enforced
- [ ] `react`, `edit_message`, and `fetch_messages` function correctly
- [ ] Polling deduplicates comments and survives restarts via the persisted cursor
- [ ] Rate-limit handling backs off without crashing
- [ ] `/github:access` and `/github:configure` skills manage state correctly
- [ ] `turbo check` (build + typecheck) and `bun run lint` pass; new-code coverage > 80%
