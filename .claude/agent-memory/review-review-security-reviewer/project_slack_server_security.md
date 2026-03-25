---
name: slack_server_security_review
description: Security vulnerabilities found in plugins/slack/server.ts during initial review (2026-03-25)
type: project
---

Security review of plugins/slack/server.ts completed on 2026-03-25. File is a new addition (new file diff from main).

## Critical Findings

1. **ReDoS via mentionPatterns** (L335-342): `mentionPatterns` from access.json are compiled into RegExp with no complexity limit. Catastrophic backtracking patterns will stall the event loop.

2. **Path Traversal in reply tool** (L144-154, L598-634): `assertSendable` uses a blocklist approach — only denies STATE_DIR contents. Allows any other filesystem path. Silent allow on `realpathSync` failure (TOCTOU gap). Model can be prompted to upload `/etc/passwd`, SSH keys, etc.

3. **Prompt Injection** (L809-824): Raw Slack message text and filenames forwarded verbatim to MCP notification content. No structural separation between user-controlled input and model instructions.

## Important Findings

4. **Approval dir filename unvalidated** (L349-387): `senderId` filenames in APPROVED_DIR used as Slack UIDs without format validation. `dmChannelId` file contents not validated before passing to Slack API.

5. **Token leakage to child processes** (L69-91): BOT_TOKEN and APP_TOKEN stored in process.env, inherited by any child processes. Values also not trimmed (trailing whitespace possible).

6. **DM gate relies solely on channel_type field** (L250-310): `isDM()` only checks `channel_type === 'im'`, no channel ID prefix verification. Brittle if Slack omits field.

7. **Race condition in access.json read-modify-write** (L254-208): No mutex on gate(); concurrent events can duplicate pairing codes or exceed the pending-cap.

8. **Unrestricted file extension for downloaded attachments** (L463-468): Extension derived from Slack filename after stripping non-alphanum. No blocklist for dangerous extensions (`.sh`, `.py`, `.exe`, etc.).

**Why:** This is a new plugin with significant attack surface — handles tokens, access state files, file downloads, and AI model input.

**How to apply:** When reviewing future changes to this file, prioritize the assertSendable allowlist inversion (CRITICAL-2) and the mentionPatterns ReDoS (CRITICAL-1) as the highest-risk unresolved items.
