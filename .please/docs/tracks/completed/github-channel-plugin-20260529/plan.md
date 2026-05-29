# Plan: GitHub Channel Plugin

> Track: `github-channel-plugin-20260529`
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/github-channel-plugin-20260529/spec.md
- **Issue**: TBD
- **Created**: 2026-05-29
- **Approach**: Reference-Aligned — follow the existing `plugins/slack/server.ts` channel pattern, adapted for GitHub REST polling

## Purpose

After this change, developers will be able to interact with Claude Code from GitHub issue/PR conversations. They can verify it works by installing the plugin, configuring a PAT and watched repos with `/github:configure`, allowlisting their GitHub login with `/github:access allow <login>`, and posting a comment that @mentions the configured handle on a watched issue/PR — Claude receives it and replies back as a comment.

## Context

Claude Code supports channel plugins — MCP servers that bridge external systems with Claude sessions (see channels-reference). The project already ships a proven single-file channel in `plugins/slack/server.ts`. This track adds a GitHub channel following the same protocol and conventions.

Unlike Slack/Telegram/Discord, GitHub has no real-time DM transport and its webhooks require a public URL, which a local MCP subprocess cannot expose. The plugin therefore **polls** the GitHub REST API (the same model the Telegram/Discord channels use for their platforms). Inbound events are **@mention comments** on issues/PRs in watched repositories; outbound posts/reacts/edits comments on the originating thread. Authentication uses a fine-grained **Personal Access Token**.

The plugin must be a single self-contained `server.ts` file per the architecture invariant. Access control gates on the commenter's GitHub login (sender), never the repo/issue id. State lives in `~/.claude/channels/github/`.

Non-goals: GitHub App / installation-token auth, webhook ingestion, the broad Notifications API feed, and permission relay (possible follow-up track).

## Architecture Decision

Follow the Slack channel architecture directly. The GitHub plugin is structurally analogous — the differences are the platform SDK (`@octokit/rest` instead of `@slack/*`) and a **poll loop with a persisted cursor** instead of a Socket Mode WebSocket. Conditional requests (ETag/`since`) and rate-limit backoff keep REST usage within the PAT budget.

The single-file constraint keeps all concerns (MCP server, GitHub client, access control, poll loop, tools) in `server.ts`. Skills are separate SKILL.md files for access management and token/repo configuration, following the Slack skill pattern.

State shapes:

```ts
interface AccessState { mode: 'allowlist' | 'open'; allowedLogins: string[]; configured: boolean }
interface PollCursor { repos: Record<string, { etag?: string; since?: string; lastCommentId?: number }> }
```

Configuration (env, from `~/.claude/channels/github/.env`): `CLAUDE_GITHUB_TOKEN` (required PAT), `CLAUDE_GITHUB_REPOS` (required, `owner/repo,...`), `CLAUDE_GITHUB_MENTION` (optional, default = authed login), `CLAUDE_GITHUB_POLL_INTERVAL_MS` (optional, default 5000), `GITHUB_ACCESS_MODE` (optional).

## Tasks

### Phase 1: Project Scaffold

- [x] T001 Create GitHub plugin package with workspace config (file: plugins/github/package.json) — `claude-channel-github`, `bin: ./server.ts`, deps `@modelcontextprotocol/sdk` + `@octokit/rest`
- [x] T002 Create plugin manifest and MCP server config (files: plugins/github/.claude-plugin/plugin.json, plugins/github/.mcp.json)

### Phase 2: Core Server

- [x] T003 Implement env/config loading + MCP server scaffold (capabilities `tools` + `experimental['claude/channel']`, instructions) (file: plugins/github/server.ts) (depends on T001)
- [x] T004 Implement access control with sender gating on commenter login and atomic access.json (file: plugins/github/server.ts) (depends on T003)
- [x] T005 Implement Octokit init + authed-login resolution + poll loop with cursor/ETag and rate-limit backoff (file: plugins/github/server.ts) (depends on T003)
- [x] T006 Implement @mention detection, dedup, and `notifications/claude/channel` emit with full meta (file: plugins/github/server.ts) (depends on T004, T005)

### Phase 3: Outbound Tools

- [x] T007 Implement reply tool — post comment to thread from chat_id, outbound gating, chunking at ~65,536 chars (file: plugins/github/server.ts) (depends on T006)
- [x] T008 [P] Implement react tool (reactions API, validate name) (file: plugins/github/server.ts) (depends on T007)
- [x] T009 [P] Implement edit_message tool (edit own comments only) (file: plugins/github/server.ts) (depends on T007)
- [x] T010 [P] Implement fetch_messages tool (recent comments for an issue/PR) (file: plugins/github/server.ts) (depends on T007)

### Phase 4: Skills, Tests & Polish

- [x] T011 Create access management skill `/github:access` (allow/remove/policy/list) (file: plugins/github/skills/access/SKILL.md) (depends on T004)
- [x] T012 Create configure skill `/github:configure <token> [repos]` writing .env (0o600) + repos (file: plugins/github/skills/configure/SKILL.md) (depends on T003)
- [x] T013 Write server.test.ts — access load/save, sender gating, mention parsing, dedup/cursor, reply chunking, outbound gating (mock Octokit) (file: plugins/github/server.test.ts) (depends on T007)
- [x] T014 Write README.md + README.ko.md (PAT scopes, .env, --channels usage, skill flows) (files: plugins/github/README.md, plugins/github/README.ko.md) (depends on T012)

## Key Files

### Create

- `plugins/github/package.json` — Package manifest with Octokit + MCP SDK dependencies
- `plugins/github/server.ts` — Complete MCP server (single file, target < 500 LOC where practical)
- `plugins/github/.claude-plugin/plugin.json` — Plugin manifest for Claude Code
- `plugins/github/.mcp.json` — MCP server launch config (`bun --cwd ${CLAUDE_PLUGIN_ROOT} server.ts`)
- `plugins/github/server.test.ts` — Unit tests (Bun test)
- `plugins/github/skills/access/SKILL.md` — Access management skill
- `plugins/github/skills/configure/SKILL.md` — Token/repo configuration skill
- `plugins/github/README.md`, `plugins/github/README.ko.md` — Setup docs

### Reuse (Reference)

- `plugins/slack/server.ts` — Primary reference for channel protocol, MCP wiring, tool handlers, atomic state writes
- `plugins/slack/.mcp.json`, `plugins/slack/.claude-plugin/plugin.json`, `plugins/slack/package.json` — Metadata templates
- `plugins/slack/skills/access/SKILL.md`, `plugins/slack/skills/configure/SKILL.md` — Skill templates

## Verification

### Automated Tests

- [ ] Config loading: missing token / malformed repos exit non-zero with guidance; valid config parses repos
- [ ] AccessState round-trips; corrupt file falls back to default
- [ ] Sender gating: `open` passes all; `allowlist` passes only listed logins (case-insensitive)
- [ ] Mention detection: only comments mentioning the handle and not self-authored pass
- [ ] Dedup/cursor: replayed comments after restart are not re-emitted
- [ ] `notifications/claude/channel` emitted with chat_id/message_id/user/url/repo/issue_number/comment_type
- [ ] reply posts to correct `owner/repo#number`; rejects un-watched repos; chunks long bodies
- [ ] react validates reaction name; edit_message rejects foreign comment ids
- [ ] fetch_messages returns bounded oldest-first list

### Observable Outcomes

- After configuring token/repos and @mentioning the handle on a watched issue, Claude receives a `<channel source="github">` event and replies via a comment
- Running `ls ~/.claude/channels/github/` shows `.env`, `access.json`, `cursor.json`
- Poll loop survives a restart without re-delivering old comments

### Manual Testing

- [ ] End-to-end: `/github:configure` → `/github:access allow <login>` → @mention on watched issue → reply comment from Claude
- [ ] Comment from a non-allowlisted login is dropped silently
- [ ] A reply > 65,536 chars arrives as multiple comments
- [ ] Rate-limit path backs off without crashing

## Progress

_(updated during /please:implement)_

## Decision Log

- Decision: Poll the GitHub REST API instead of webhooks
  Rationale: A local MCP subprocess has no public URL; webhooks from github.com cannot reach it. Polling matches the Telegram/Discord channel model.
  Date/Author: 2026-05-29 / Claude
- Decision: Inbound = @mention comments only (not Notifications API or all comments)
  Rationale: Minimizes noise, mirrors the Slack mention pattern; user-selected.
  Date/Author: 2026-05-29 / Claude
- Decision: Fine-grained PAT auth (not GitHub App)
  Rationale: Single-user/small-team simplicity, mirrors Slack `.env` token pattern; user-selected.
  Date/Author: 2026-05-29 / Claude

## Risks & Notes

- Rate limits: PAT REST budget is 5,000 req/h; per-repo conditional requests + a sensible interval keep usage low.
- PR conversation comments use the issues API; PR *review* comments use a separate endpoint — T005/T006 must cover both, tagged via `comment_type`.
- No DM pairing on GitHub — the allowlist is seeded explicitly via `/github:access allow` (closer to the iMessage model).
- Must filter comments authored by the authed account to avoid self-mention loops.

## Progress

- [x] (2026-05-29) T001 Plugin scaffold — package.json (claude-channel-github + @octokit/rest)
- [x] (2026-05-29) T002 plugin.json + .mcp.json
- [x] (2026-05-29) T003 env/config loading + MCP server scaffold
- [x] (2026-05-29) T004 access control (sender gating on commenter login, atomic access.json)
- [x] (2026-05-29) T005 Octokit init + authed-login resolution + poll loop with cursor + rate-limit backoff
- [x] (2026-05-29) T006 @mention detection, dedup, notifications/claude/channel emit with full meta
- [x] (2026-05-29) T007 reply tool (outbound gating + chunking)
- [x] (2026-05-29) T008 react tool
- [x] (2026-05-29) T009 edit_message tool (own-comment guard)
- [x] (2026-05-29) T010 fetch_messages tool
- [x] (2026-05-29) T011 /github:access skill
- [x] (2026-05-29) T012 /github:configure skill
- [x] (2026-05-29) T013 server.test.ts (33 tests: pure helpers, cores, dispatch, pollRepo, loadDotEnv, MCP-stdio integration)
- [x] (2026-05-29) T014 README.md + README.ko.md

## Outcomes & Retrospective

### What Was Shipped

- GitHub channel plugin (`plugins/github/`, single-file `server.ts`) — REST polling of watched repos for @mention issue/PR comments, four tools (reply, react, edit_message, fetch_messages), sender gating on commenter login, atomic state (access.json, cursor.json), rate-limit backoff.
- `/github:access` and `/github:configure` skills; English + Korean READMEs.
- 33 tests passing; coverage 85.71% funcs / 82.41% lines; eslint + tsc clean.

### Decisions / Notes

- Polling (not webhooks) — local subprocess has no public URL. `since`-cursor + comment-id dedup; ETag deferred to avoid Octokit 304 fragility.
- PR review comments (diff-line) deferred — inbound covers issue + PR conversation comments (`issues.listCommentsForRepo`), tagged `comment_type` issue|pr. Follow-up: add `pulls.listReviewCommentsForRepo`.
- Repo labels `type/feature`/`status/draft` do not exist in this repo; Issue #6 created without labels.

## Review

- [x] (2026-05-29 KST) Quality review complete (SHA: `7f3c20e`)
  - Spec compliance: 6/8 FR fully implemented, 2 PARTIAL reconciled by aligning types with documented scope (dropped unused `RepoCursor.etag`, never-emitted `pr_review`).
  - Code review: no quality issues; all CLAUDE.md invariants (sender/outbound gating, atomic writes, stderr-only, prompt-injection posture) verified.
  - Fixes applied: refuse-to-poll on unresolved identity (self-loop/PAT-exhaustion guard); surface access.json/cursor.json corruption on stderr; +4 negative-path tests for outbound gating and null/self author filtering.
  - Final: 45 tests pass, lint clean, tsc clean (github), coverage 95% funcs / 81% lines.
