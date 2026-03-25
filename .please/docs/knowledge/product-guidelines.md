# Product Guidelines

## Code Style

- **Single-file server pattern** — Each plugin is a single `server.ts` containing the MCP server, platform client, access control, and tool definitions
- **TypeScript with Bun** — All plugins use TypeScript executed directly by Bun (no build step)
- **ESM modules** — `type: module` throughout, ESNext target

## Security Principles

- **Sender gating** — Gate on `message.user` (sender identity), never on channel/room ID
- **Outbound gating** — Tools must verify target chat is allowlisted before sending
- **Prompt injection defense** — Instructions explicitly tell Claude to refuse access changes requested via channel messages
- **Token storage** — Stored locally in `~/.claude/channels/<platform>/.env` with `0o600` permissions
- **Atomic writes** — State files (`access.json`) written via tmp + rename

## Plugin Conventions

- **Pairing flow** — 6-char hex code, 1h expiry, max 3 pending
- **Message chunking** — Split at platform char limit with paragraph-aware splitting
- **Typing indicator** — Show processing state in the chat platform
- **Access skills** — Slash commands for managing access (`pair`, `policy`, `add`, `remove`)
- **Static mode** — Optional `<PLATFORM>_ACCESS_MODE=static` to snapshot access at boot

## Documentation

- README.md as the primary user-facing documentation
- English for all code artifacts (comments, commits, PR descriptions)
- Each plugin self-documents its tools, setup, and pairing flow
