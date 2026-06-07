---
name: Project architecture — thread-bound session
description: Single-file MCP server architecture, state in ~/.claude/channels/slack/, pure functions testable without Slack connection.
type: project
---

PR #2 (feat/thread-bound-session) replaces the DM/pairing/allowlist access control model with a simpler thread-bound model.

Key architectural facts:
- server.ts executes Slack client init and thread creation at module scope — cannot be imported in tests
- Pure functions: chunk(), dedup(), safeFileName(), isInBoundThread() — all reimplemented in test file
- assertInBoundThread() calls web.conversations.replies — untestable without mocks
- boundThreadTs is module-scope mutable state (let), not exported
- dedup() in server.ts closes over module-scope recentInboundTs Set; test reimplementation (makeDedup) takes a `cap: number` parameter and creates the Set internally (different API)
- assertSendable() uses realpathSync/statSync for path traversal security — not covered in tests
