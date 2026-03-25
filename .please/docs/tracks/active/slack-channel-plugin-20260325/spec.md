# Slack Channel Plugin — Specification

## Overview

Two-way channel plugin connecting a Slack workspace to Claude Code via Socket Mode. Runs locally with no public URL required. Implements the Claude Code Channels protocol as an MCP server.

## Functional Requirements

### FR-001: Socket Mode Connection

- Connect to Slack via Socket Mode using app-level token (`xapp-`)
- Maintain persistent WebSocket connection with automatic reconnection

### FR-002: Inbound Messaging

- Receive direct messages and `app_mention` events
- Forward messages as `notifications/claude/channel` with metadata (`chat_id`, `message_id`, `user`, `user_id`, `ts`)

### FR-003: Sender Access Control

- Maintain sender allowlist in `~/.claude/channels/slack/access.json`
- Gate on `message.user` (sender identity), not channel ID
- Pairing flow: 6-char hex code, 1h expiry, max 3 pending
- Support `SLACK_ACCESS_MODE=static` for snapshot at boot

### FR-004: Outbound Messaging (reply tool)

- Send messages back to Slack with outbound gating
- Support `reply_to` for threading
- Support `files` for attachments
- Message chunking at 4000-char limit with paragraph-aware splitting

### FR-005: Message Operations

- `react` — Add emoji reaction to a message
- `edit_message` — Edit a previously sent message
- `fetch_messages` — Fetch recent messages from a channel
- `download_attachment` — Download file attachments to local inbox

### FR-006: Typing Indicator & Ack Reaction

- Show typing indicator while processing
- Add ack reaction (e.g., :eyes:) when message is received

### FR-007: Access Management Skills

- `/slack:access pair <code>` — Pair a sender
- `/slack:access policy <mode>` — Set access policy
- `/slack:access add <user_id>` — Add user to allowlist
- `/slack:access remove <user_id>` — Remove user from allowlist
- `/slack:configure <bot-token> <app-token>` — Configure tokens

### FR-008: Security

- Tokens stored in `~/.claude/channels/slack/.env` with `0o600` permissions
- Atomic writes for `access.json` (tmp + rename)
- Prompt injection defense in Claude instructions

## Non-Functional Requirements

- Single-file `server.ts` pattern (following reference implementations)
- No build step — direct Bun execution
- No public endpoints required

## Success Criteria

- [ ] Two-way messaging works via Slack DM and mentions
- [ ] Pairing flow completes successfully
- [ ] Sender gating blocks unauthorized users
- [ ] Message chunking handles messages > 4000 chars
- [ ] File attachments work in both directions
- [ ] All tools function correctly (reply, react, edit, fetch, download)
