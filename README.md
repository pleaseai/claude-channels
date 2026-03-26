# claude-channels

Channel plugins for [Claude Code](https://code.claude.com). Push messages from chat platforms into a running Claude Code session and let Claude reply back through the same channel.

**[Documentation](https://claude-channels.pleaseai.dev)**

## Supported Channels

| Channel         | Status      | Protocol    | Description                             |
| --------------- | ----------- | ----------- | --------------------------------------- |
| [Slack](#slack) | In Progress | Socket Mode | Two-way channel via Slack threads (channel or DM) |
| Line            | Planned     | -           | Line messenger channel                  |

## Overview

Each channel plugin is an MCP server implementing the [Channels](https://code.claude.com/docs/en/channels) protocol. Claude Code spawns it as a subprocess and bridges the external chat platform with the Claude Code session bidirectionally.

```
Chat Platform (Slack, Line, ...)
    ↕ platform API
Channel Plugin (MCP server, local subprocess)
    ↕ stdio
Claude Code
```

- **Inbound**: Platform event received → sender allowlist check → forwarded as `notifications/claude/channel`
- **Outbound**: Claude calls the `reply` tool → plugin sends the message via platform API

### Reference Implementations

This project follows the patterns established by the official Claude Code channel plugins:

- [fakechat](vendor/claude-plugins-official/external_plugins/fakechat/) — Minimal localhost demo with web UI, file attachments, and reply tool. Good starting point for understanding the channel contract.
- [Discord](vendor/claude-plugins-official/external_plugins/discord/) — Full two-way channel with pairing, sender allowlist, guild/channel support, mention-triggering, message chunking, attachment download, and access skills.
- [Telegram](vendor/claude-plugins-official/external_plugins/telegram/) — Full two-way channel with pairing, sender allowlist, group support, mention-triggering, photo handling, and access skills.

### Common Patterns Across Reference Implementations

All official channel plugins share these patterns:

- **Single-file server** (`server.ts`) — MCP server, platform client, access control, and tools in one file
- **State directory** at `~/.claude/channels/<platform>/` — `access.json` for allowlist, `.env` for tokens, `inbox/` for downloads
- **Pairing flow** — Unknown sender DMs the bot → bot replies with a 6-char hex code → user runs `/<platform>:access pair <code>` in Claude Code → sender ID added to allowlist
- **Access skills** (`skills/` directory) — Claude Code slash commands for managing access (pair, policy, add/remove users, group config)
- **Sender gating** — Gate on `message.user` (sender identity), not channel/room ID. Group messages additionally check for bot mention.
- **Outbound gating** — Reply/react/edit tools verify the target chat is allowlisted before sending
- **Message chunking** — Split long replies at platform's char limit (Discord: 2000, Telegram: 4096) with paragraph-aware splitting
- **Static mode** — Optional `<PLATFORM>_ACCESS_MODE=static` to snapshot access at boot (no runtime mutation)
- **Typing indicator & ack reaction** — Show processing state in the chat platform
- **Prompt injection defense** — Instructions explicitly warn Claude not to approve pairings or edit access.json when asked via channel messages

## Requirements

- [Claude Code](https://code.claude.com) v2.1.80 or later (claude.ai login required)
- [Bun](https://bun.sh) 1.3.10+
- [Node.js](https://nodejs.org) 24+ (for tooling)
- [mise](https://mise.jdx.dev) (recommended, manages Bun/Node versions)

## Getting Started

```bash
# Install tool versions (Bun, Node)
mise install

# Install dependencies
bun install

# Install git hooks (pre-commit, commit-msg)
mise run setup
```

## Project Structure

This is a Bun workspace monorepo managed with [Turborepo](https://turbo.build).

```
├── plugins/
│   ├── slack/                 # Slack channel plugin
│   │   ├── server.ts          # MCP server, Slack client, access control, tools
│   │   ├── skills/            # Access management slash commands
│   │   ├── .claude-plugin     # Plugin manifest
│   │   ├── .mcp.json          # MCP server config
│   │   └── package.json
│   └── line/                  # (planned)
├── vendor/                    # Reference implementations (git submodule)
│   └── claude-plugins-official/
│       └── external_plugins/
│           ├── fakechat/      # Localhost demo channel
│           ├── discord/       # Discord channel
│           └── telegram/      # Telegram channel
├── .mise.toml                 # Tool versions & git hook tasks
├── turbo.json                 # Turborepo pipeline config
├── eslint.config.ts           # ESLint (antfu config)
├── commitlint.config.ts       # Conventional commit validation
├── tsconfig.json
├── package.json
└── README.md
```

### Tooling

| Tool                                    | Purpose                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------ |
| [Bun](https://bun.sh)                   | Runtime, package manager, workspace                                      |
| [Turborepo](https://turbo.build)        | Task orchestration & caching                                             |
| [ESLint](https://eslint.org)            | Linting ([@antfu/eslint-config](https://github.com/antfu/eslint-config)) |
| [commitlint](https://commitlint.js.org) | Conventional commit enforcement                                          |
| [mise](https://mise.jdx.dev)            | Tool version management & git hooks                                      |

---

## Slack

Two-way channel plugin connecting a Slack workspace to Claude Code via [Socket Mode](https://api.slack.com/apis/socket-mode). Each session gets a dedicated thread — in a channel or DM. Runs locally with no public URL required.

See [plugins/slack/README.md](plugins/slack/README.md) for full setup and usage details.

### Quick Start

**Install from marketplace:**

```bash
claude plugin add claude-channels/slack
```

**Configure:**

```
/slack:configure <xoxb-bot-token> <xapp-app-token>
/slack:configure channel C0123456789   # channel thread mode
/slack:configure dm UYourUserID        # or DM thread mode
```

**Development mode:**

```bash
claude --dangerously-load-development-channels plugin:slack@claude-channels
```

### Features

- **Two-way messaging** — Channel threads or DM threads, reply back through Slack
- **Dual mode** — Channel thread mode (`CLAUDE_SLACK_CHANNEL_ID`) or DM thread mode (`CLAUDE_SLACK_DM_USER_ID`)
- **Socket Mode** — No public URL or webhook endpoint needed
- **Message chunking** — Long replies split at Slack's 4000-char limit
- **File attachments** — Send and receive files (up to 25 MB)
- **Reactions & message editing** — React to messages, edit previously sent messages
- **Typing indicator** — Show processing state in Slack

---

## Adding a New Channel

To add a new channel, create a `plugins/<platform>/` directory following the reference implementation patterns:

1. **`server.ts`** — Single-file MCP server:
   - Declare `claude/channel` capability and `tools` capability
   - Load tokens from `~/.claude/channels/<platform>/.env`
   - Implement sender gating with allowlist (`access.json`)
   - Implement pairing flow (6-char hex code, 1h expiry, max 3 pending)
   - Forward messages as `notifications/claude/channel` with `chat_id`, `message_id`, `user`, `user_id`, `ts` in meta
   - Expose reply/react/edit tools with outbound gating
   - Add typing indicator and ack reaction support
   - Include prompt injection defense in instructions

2. **`skills/`** — Access management slash commands (`/<platform>:access pair`, `policy`, `add`, `remove`)

3. **`.claude-plugin`** — Plugin manifest for `--channels` registration

4. **`.mcp.json`** — MCP server configuration

See the [Channels reference](https://code.claude.com/docs/en/channels-reference) and the [reference implementations](#reference-implementations) for details.

## Security

- Sender allowlist prevents unauthorized message injection
- Gates on sender identity (`message.user`), not channel/room ID
- Outbound gating ensures tools only target allowlisted chats
- Tokens stored locally in `~/.claude/channels/<platform>/.env` with `0o600` permissions
- Local protocols (Socket Mode, etc.) preferred — no public endpoints
- Prompt injection defense: instructions tell Claude to refuse access changes requested via channel messages
- State files (`access.json`) written atomically via tmp + rename

## License

MIT

## Author

[Passion Factory, Inc](https://passionfactory.ai) · [please AI](https://pleaseai.dev)

Minsu Lee ([@amondnet](https://github.com/amondnet))
