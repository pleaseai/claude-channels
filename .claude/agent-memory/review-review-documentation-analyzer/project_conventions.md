---
name: Project documentation conventions and accuracy issues
description: Documentation patterns, conventions, and known accuracy issues for claude-channel-slack
type: project
---

## Documentation conventions

- Plugin README lives at `plugins/slack/README.md`
- Docs site uses Docus (Nuxt Content) at `apps/docs/content/` with numeric prefix ordering
- Startup log format: `slack channel: <message>` on stderr
- State dir: `~/.claude/channels/slack/` (env file + inbox/)
- Tool parameter names use snake_case: `message_id`, `emoji`, `text`, `files`, `limit`

## Known accuracy issue found in PR #2 review

- `reply` tool uses hard-length chunking (`mode: 'length'`), NOT smart natural-break splitting. Documentation incorrectly describes "natural break points (paragraphs, newlines, spaces)".
- `app_mention` events are filtered by `isInBoundThread()` — mentions outside the bound thread are silently dropped. Documentation implies @mentions "start interacting" which suggests channel-level mentions work.

**Why:** The `chunk()` function supports both `'length'` and `'newline'` modes but `reply` uses `'length'`. The mention filtering is strict thread-only, not channel-level.
**How to apply:** When reviewing or updating tool documentation, verify which chunk mode is used. When documenting mention behavior, clarify thread-scoped vs channel-level.
