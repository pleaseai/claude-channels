# Plan: Thread-Bound Session

> Track: thread-bound-session-20260325
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/thread-bound-session-20260325/spec.md
- **Issue**: TBD
- **Created**: 2026-03-25
- **Approach**: Simplification — replace DM/pairing/allowlist access control with thread-scoped binding

## Purpose

After this change, each Claude Code session will automatically create a dedicated Slack thread and communicate exclusively within it. Users can run multiple sessions simultaneously on the same Bot without message interference, and verify it works by checking that each session's thread contains only its own conversation.

## Context

The current Slack plugin (`plugins/slack/server.ts`, ~890 lines) supports multi-channel access with DM-based pairing, sender allowlists, and channel group policies. This complexity is unnecessary when the goal is a simple 1:1 binding between a Claude Code session and a Slack thread.

The thread-bound model eliminates the need for `access.json`, pairing codes, approval polling, and channel gating. Instead, the server creates a new thread at startup in a channel specified by `SLACK_CHANNEL_ID`, and all inbound/outbound messages are scoped to that thread. The thread itself becomes the access boundary.

Key constraints:
- Single-file MCP server architecture must be maintained
- State files remain in `~/.claude/channels/slack/`
- Socket Mode connection is shared; thread filtering handles message isolation
- `SLACK_CHANNEL_ID` is required (no fallback to unbound mode)

Non-goals:
- Preserving backward compatibility with the current unbound/pairing model
- DM support
- Multi-thread binding

## Architecture Decision

The chosen approach is a **simplification rewrite** of `server.ts`. Rather than layering thread-binding on top of the existing access control system, we remove the DM/pairing/allowlist/group machinery entirely and replace it with a thread-scoped model.

Rationale: The existing access control (~300 lines) is designed for a fundamentally different use case (multi-channel, multi-user). Keeping it alongside thread-binding would create dead code paths and confusing configuration. A clean replacement is safer and more maintainable.

The thread lifecycle:
1. Server starts → `web.chat.postMessage({ channel: SLACK_CHANNEL_ID })` → store `ts` as `boundThreadTs`
2. Inbound: Only accept messages where `msg.thread_ts === boundThreadTs`
3. Outbound: All reply/react/edit operations target `boundThreadTs` channel + thread
4. Server stops → thread persists in Slack (read-only history)

## Tasks

- [ ] T001 Strip access control and add thread binding core (file: plugins/slack/server.ts)
- [ ] T002 Implement thread-scoped inbound filtering (file: plugins/slack/server.ts, depends on T001)
- [ ] T003 Implement thread-forced outbound tools (file: plugins/slack/server.ts, depends on T001)
- [ ] T004 Update MCP instructions and tool descriptions (file: plugins/slack/server.ts, depends on T002, T003)
- [ ] T005 Add startup validation and error handling (file: plugins/slack/server.ts, depends on T001)
- [ ] T006 Update tests for thread-bound behavior (file: plugins/slack/__tests__/, depends on T002, T003, T005)

## Key Files

### Modify

- `plugins/slack/server.ts` — Main MCP server. Remove: `Access` interface, `gate()`, `assertAllowedChannel()`, `checkApprovals()`, pairing logic, `access.json` read/write. Add: `SLACK_CHANNEL_ID` requirement, `boundThreadTs` state, thread creation at startup, inbound thread filter, outbound thread forcing.

### Reuse

- `plugins/slack/server.ts` — Keep: `SlackMessage` interface, `dedup()`, `chunk()`, `downloadFile()`, `safeFileName()`, `noteSent()`, `recentSentIds`, Socket Mode event handlers (with filter added), MCP server setup, tool handler switch structure.

### Create

- (none — single-file architecture maintained)

## Verification

### Automated Tests

- [ ] Server exits with error when `SLACK_CHANNEL_ID` is not set
- [ ] Thread creation message is posted to correct channel at startup
- [ ] Messages with matching `thread_ts` are delivered via MCP notification
- [ ] Messages with non-matching `thread_ts` or no `thread_ts` are dropped
- [ ] Reply tool always sends with `thread_ts` set to `boundThreadTs`
- [ ] React tool only works on messages within bound thread
- [ ] Edit tool only works on messages within bound thread
- [ ] File attachments work within bound thread
- [ ] Multiple concurrent sessions with different threads don't interfere

### Observable Outcomes

- After starting the server, a new message appears in the specified Slack channel starting a thread
- Sending a message in that thread triggers a Claude Code notification
- Sending a message outside the thread produces no notification
- Running `reply` always posts within the thread

### Manual Testing

- [ ] Start server with `SLACK_CHANNEL_ID=C12345` → thread created in #channel
- [ ] Post in thread → message appears in Claude Code session
- [ ] Post in channel (not thread) → no message delivered
- [ ] Start two sessions → two separate threads, no cross-talk

## Decision Log

- Decision: Replace access control with thread-scoped binding (not layer on top)
  Rationale: Existing access control is ~300 lines for a different use case; layering would create dead code
  Date/Author: 2026-03-25 / Claude

- Decision: Require `SLACK_CHANNEL_ID` (no fallback to unbound mode)
  Rationale: User confirmed always thread-bound; no need for backward compatibility
  Date/Author: 2026-03-25 / Claude
