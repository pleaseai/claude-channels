# Architecture

> Agent-first template: optimized for AI agent consumption (Claude Code, etc.)

## System Overview

**Purpose**: claude-channels is a collection of channel plugins that bridge external chat platforms (Slack, Line, etc.) with Claude Code sessions via the MCP (Model Context Protocol) Channels protocol.

**Primary users**: Developers using Claude Code who want to interact with it from Slack, Line, or other chat platforms.

**Core workflow**:

1. Chat platform delivers a message (DM or mention) to the channel plugin via platform SDK (e.g., Socket Mode for Slack)
2. Plugin checks sender against allowlist, then forwards the message as a `notifications/claude/channel` notification to Claude Code via stdio
3. Claude processes the message and calls MCP tools (`reply`, `react`, `edit_message`, etc.) which the plugin executes via the platform API

**Key constraints**: Runs as a local subprocess — no public endpoints. Security enforced via sender allowlist with pairing flow.

## Dependency Layers

Each plugin is a **single-file MCP server** (`server.ts`). There are no application layers — each plugin is self-contained with all concerns in one file, following the official Claude Code channel plugin pattern.

```
┌─────────────────────────────────────────┐
│           Claude Code (host)            │  Spawns plugin as subprocess
├─────────────────────────────────────────┤
│     Channel Plugin (MCP server)         │  plugins/<platform>/server.ts
│  ┌─────────┬──────────┬───────────┐     │
│  │ Access  │ Message  │   Tools   │     │  All concerns in one file
│  │ Control │ Routing  │ (reply,   │     │
│  │         │          │  react,   │     │
│  │         │          │  edit...) │     │
│  └─────────┴──────────┴───────────┘     │
├─────────────────────────────────────────┤
│         Platform SDK                    │  @slack/socket-mode, discord.js, etc.
├─────────────────────────────────────────┤
│         Chat Platform API               │  Slack, Discord, Telegram, Line
└─────────────────────────────────────────┘
```

**Invariant**: Each plugin is fully self-contained. Plugins do NOT share code or import from each other. This matches the official Claude Code plugin pattern where each plugin must be independently installable.

## Entry Points

For understanding a channel plugin:

- `plugins/<platform>/server.ts` — The entire plugin: MCP server setup, platform client initialization, access control, message routing, and tool definitions
- `plugins/<platform>/skills/` — Claude Code slash commands for access management (`pair`, `policy`, `add`, `remove`)

For understanding the project structure:

- `package.json` — Bun workspace root defining `plugins/*` as workspaces
- `turbo.json` — Turborepo task pipeline (build, check, lint)
- `.mise.toml` — Tool versions (Bun, Node) and git hook tasks

For understanding the channel contract:

- `vendor/claude-plugins-official/external_plugins/discord/server.ts` — Reference implementation showing the complete channel pattern
- `vendor/claude-plugins-official/external_plugins/telegram/server.ts` — Alternative reference with different platform SDK

## Module Reference

| Module                            | Purpose                                            | Key Files                                       | Depends On                                                          | Depended By                |
| --------------------------------- | -------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------- | -------------------------- |
| `plugins/slack/`                  | Slack channel plugin (Socket Mode)                 | `server.ts`, `skills/`                          | `@slack/web-api`, `@slack/socket-mode`, `@modelcontextprotocol/sdk` | Claude Code (host)         |
| `plugins/line/`                   | Line messenger channel (planned)                   | —                                               | TBD                                                                 | Claude Code (host)         |
| `vendor/claude-plugins-official/` | Official reference implementations (git submodule) | `external_plugins/{discord,telegram,fakechat}/` | —                                                                   | Development reference only |

## Architecture Invariants

**Single-file server**: Each plugin MUST be a single `server.ts` file containing the MCP server, platform client, access control, and tool definitions. Do NOT split into multiple modules — this matches the official Claude Code channel plugin pattern and ensures plugins are independently installable.

**Sender gating over channel gating**: Access control MUST gate on `message.user` (sender identity), never on channel/room ID. Group messages additionally require bot mention. Violating this would allow unauthorized users in shared channels to inject messages into Claude sessions.

**Outbound gating**: All tools that send messages (`reply`, `react`, `edit_message`) MUST verify the target chat is allowlisted before sending. This prevents Claude from being tricked into messaging arbitrary channels.

**State directory convention**: All runtime state lives in `~/.claude/channels/<platform>/` — `access.json` for allowlist, `.env` for tokens, `inbox/` for downloads. Do NOT store state inside the project directory. Tokens MUST have `0o600` permissions.

**Atomic state writes**: State files (`access.json`) MUST be written atomically via tmp file + rename. Do NOT write directly to the state file — partial writes would corrupt the allowlist.

## Cross-Cutting Concerns

**Error handling**: Platform SDK errors are caught and logged to stderr. The MCP server continues running — individual message failures do not crash the plugin. Tool calls return error responses via MCP protocol.

**Logging**: Plugins write to stderr (stdout is reserved for MCP stdio transport). No structured logging library — `process.stderr.write()` for diagnostics.

**Testing**: Bun test runner. Mock platform SDKs for unit tests. Target >80% coverage for new code. See `.please/docs/knowledge/workflow.md` for TDD workflow.

**Configuration**: Platform tokens loaded from `~/.claude/channels/<platform>/.env` at startup. Environment variables take precedence over `.env` file values. No build-time configuration.

**Security**: Prompt injection defense built into MCP server instructions — Claude is explicitly told to refuse access changes (pairing, allowlist edits) when requested via channel messages. This prevents users from socially engineering Claude into granting access.

## Quality Notes

**Well-tested**: Not yet — project is in initial development. Reference implementations in `vendor/` serve as proven patterns.

**Fragile**: Access control is security-critical. Changes to `access.json` handling, pairing flow, or sender gating require careful review and testing.

**Technical debt**: None yet — greenfield project.

---

_Last updated: 2026-03-25_

_Key ADRs: None yet. Use `/standards:adr` to record architecture decisions._
