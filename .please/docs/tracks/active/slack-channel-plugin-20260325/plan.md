# Plan: Slack Channel Plugin

> Track: `slack-channel-plugin-20260325`
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/slack-channel-plugin-20260325/spec.md
- **Issue**: TBD
- **Created**: 2026-03-25
- **Approach**: Reference-Aligned — follow the Discord reference implementation pattern, adapted for Slack Socket Mode

## Purpose

After this change, developers will be able to interact with Claude Code from Slack via DMs and @mentions. They can verify it works by installing the plugin, configuring their Slack tokens with `/slack:configure`, pairing their Slack identity with `/slack:access pair <code>`, and sending a DM to their Slack bot to receive a reply from Claude.

## Context

Claude Code supports channel plugins — MCP servers that bridge external chat platforms with Claude sessions. The project already has proven reference implementations for Discord and Telegram in `vendor/claude-plugins-official/`. This track implements the Slack channel following the same protocol and patterns.

Slack uses Socket Mode (WebSocket via app-level `xapp-` token) for receiving events and the Web API (`xoxb-` bot token) for sending messages. Unlike Discord's gateway, Socket Mode requires explicit event acknowledgment. Slack's message limit is 4000 characters (vs Discord's 2000). Slack threads use `thread_ts` rather than message reply references.

The plugin must be a single self-contained `server.ts` file per the ARCHITECTURE.md invariant. Access control follows the same sender-gating pattern (not channel-gating) with pairing flow for onboarding new senders.

Non-goals: Slash commands in Slack (bot commands like `/ask-claude`), interactive components (buttons, modals), Slack Events API (HTTP endpoint mode), multi-workspace support.

## Architecture Decision

Follow the Discord reference implementation architecture directly. The Slack plugin is structurally identical — the only differences are the platform SDK (`@slack/socket-mode` + `@slack/web-api` instead of `discord.js`) and Slack-specific details (thread_ts for threading, 4000-char limit, Socket Mode ack pattern). This minimizes risk and ensures protocol compatibility.

The single-file constraint keeps all concerns (MCP server, Slack client, access control, tools) in `server.ts`. Skills are separate SKILL.md files for access management and token configuration, following the Discord skill pattern exactly.

## Tasks

### Phase 1: Project Scaffold

- [x] T001 Create Slack plugin package with workspace config (file: plugins/slack/package.json)
- [x] T002 Create plugin manifest and MCP server config (file: plugins/slack/.claude-plugin/plugin.json)

### Phase 2: Core Server

- [x] T003 Implement MCP server with Socket Mode connection and inbound messaging (file: plugins/slack/server.ts) (depends on T001)
- [x] T004 Implement access control with sender gating, pairing flow, and approval polling (file: plugins/slack/server.ts) (depends on T003)
- [x] T005 Implement outbound reply tool with chunking and file attachments (file: plugins/slack/server.ts) (depends on T003)

### Phase 3: Extended Tools

- [x] T006 [P] Implement react tool (file: plugins/slack/server.ts) (depends on T005)
- [x] T007 [P] Implement edit_message tool (file: plugins/slack/server.ts) (depends on T005)
- [x] T008 [P] Implement fetch_messages tool (file: plugins/slack/server.ts) (depends on T005)
- [x] T009 [P] Implement download_attachment tool (file: plugins/slack/server.ts) (depends on T005)

### Phase 4: Skills & Polish

- [x] T010 Create access management skill (file: plugins/slack/skills/access/SKILL.md) (depends on T004)
- [x] T011 Create configure skill for token setup (file: plugins/slack/skills/configure/SKILL.md) (depends on T003)
- [x] T012 Add typing indicator and ack reaction support (file: plugins/slack/server.ts) (depends on T005)

## Key Files

### Create

- `plugins/slack/package.json` — Package manifest with Slack SDK dependencies
- `plugins/slack/server.ts` — Complete MCP server (~800-1200 LOC)
- `plugins/slack/.claude-plugin/plugin.json` — Plugin manifest for Claude Code
- `plugins/slack/.mcp.json` — MCP server launch config
- `plugins/slack/skills/access/SKILL.md` — Access management skill
- `plugins/slack/skills/configure/SKILL.md` — Token configuration skill

### Reuse (Reference)

- `vendor/claude-plugins-official/external_plugins/discord/server.ts` — Primary reference for protocol pattern
- `vendor/claude-plugins-official/external_plugins/discord/skills/access/SKILL.md` — Access skill reference
- `vendor/claude-plugins-official/external_plugins/discord/skills/configure/SKILL.md` — Configure skill reference

## Verification

### Automated Tests

- [ ] Socket Mode connection initializes with valid tokens
- [ ] Inbound DM messages are forwarded as `notifications/claude/channel`
- [ ] Inbound `app_mention` events are forwarded with correct metadata
- [ ] Access control gates unauthorized senders (returns `drop`)
- [ ] Access control delivers allowlisted senders (returns `deliver`)
- [ ] Pairing flow generates 6-char hex code with 1h expiry
- [ ] Pairing caps at 3 pending entries
- [ ] Reply tool sends messages via Slack Web API
- [ ] Reply tool chunks at 4000 chars with paragraph-aware splitting
- [ ] Reply tool attaches files to first chunk
- [ ] Outbound gate rejects messages to non-allowlisted chat IDs
- [ ] React tool adds emoji reactions
- [ ] Edit tool updates bot's own messages
- [ ] Fetch tool retrieves conversation history
- [ ] Download tool saves file attachments to inbox/

### Observable Outcomes

- After configuring tokens and sending a DM to the Slack bot, Claude receives the message and replies through the same DM
- Running `ls ~/.claude/channels/slack/` shows `access.json`, `.env`, `inbox/`, `approved/`
- After pairing, the bot sends a confirmation message in the DM thread

### Manual Testing

- [ ] Complete end-to-end: configure tokens → DM bot → pair → receive reply from Claude
- [ ] Verify unauthorized sender gets pairing prompt, not delivered to Claude
- [ ] Send a message > 4000 chars and verify it arrives as multiple chunks
- [ ] Attach a file in Slack and verify `download_attachment` tool retrieves it

## Progress

- [x] (2026-03-25 12:20 KST) T001 Create Slack plugin package with workspace config
- [x] (2026-03-25 12:20 KST) T002 Create plugin manifest and MCP server config
- [x] (2026-03-25 12:35 KST) T003 Implement MCP server with Socket Mode connection and inbound messaging
- [x] (2026-03-25 12:35 KST) T004 Implement access control with sender gating, pairing flow, and approval polling
- [x] (2026-03-25 12:35 KST) T005 Implement outbound reply tool with chunking and file attachments
- [x] (2026-03-25 12:35 KST) T006 Implement react tool
- [x] (2026-03-25 12:35 KST) T007 Implement edit_message tool
- [x] (2026-03-25 12:35 KST) T008 Implement fetch_messages tool
- [x] (2026-03-25 12:35 KST) T009 Implement download_attachment tool
- [x] (2026-03-25 12:40 KST) T010 Create access management skill
- [x] (2026-03-25 12:40 KST) T011 Create configure skill for token setup
- [x] (2026-03-25 12:35 KST) T012 Add typing indicator and ack reaction support

## Decision Log

- Decision: Follow Discord reference implementation pattern 1:1, adapted for Slack SDKs
  Rationale: Proven protocol compliance, minimal risk, consistent codebase
  Date/Author: 2026-03-25 / Claude

## Surprises & Discoveries

- Observation: Slack Web API types are loosely typed — conversations.info returns `Channel` without `user` property for DMs
  Evidence: Required `as Record<string, unknown>` cast in assertAllowedChannel
- Observation: ESLint antfu config enforces node: protocol imports, module-scope regex, no top-level await
  Evidence: Multiple lint fixes needed to match project style conventions
