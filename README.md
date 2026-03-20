# claude-channels

Channel plugins for [Claude Code](https://code.claude.com). Push messages from chat platforms into a running Claude Code session and let Claude reply back through the same channel.

## Supported Channels

| Channel | Status | Protocol | Description |
| ------- | ------ | -------- | ----------- |
| [Slack](#slack) | In Progress | Socket Mode | Two-way channel via Slack DM & mentions |
| Kakao Talk | Planned | - | Kakao Talk messenger channel |
| Line | Planned | - | Line messenger channel |

## Overview

Each channel plugin is an MCP server implementing the [Channels](https://code.claude.com/docs/en/channels) protocol. Claude Code spawns it as a subprocess and bridges the external chat platform with the Claude Code session bidirectionally.

```
Chat Platform (Slack, Kakao, Line, ...)
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
- [Bun](https://bun.sh) runtime

## Project Structure

```
├── channels/
│   ├── slack/                 # Slack channel plugin
│   │   ├── server.ts          # MCP server, Slack client, access control, tools
│   │   ├── skills/            # Access management slash commands
│   │   ├── .claude-plugin     # Plugin manifest
│   │   ├── .mcp.json          # MCP server config
│   │   └── package.json
│   ├── kakaotalk/             # (planned)
│   └── line/                  # (planned)
├── vendor/                    # Reference implementations
│   └── claude-plugins-official/
│       └── external_plugins/
│           ├── fakechat/      # Localhost demo channel
│           ├── discord/       # Discord channel
│           └── telegram/      # Telegram channel
├── package.json
├── tsconfig.json
└── README.md
```

---

## Slack

Two-way channel plugin connecting a Slack workspace to Claude Code via [Socket Mode](https://api.slack.com/apis/socket-mode). Runs locally with no public URL required.

### Features

- **Two-way messaging** — Receive DMs and mentions, reply back through Slack
- **Sender allowlist with pairing** — Only approved users can push messages into the session
- **Socket Mode** — No public URL or webhook endpoint needed
- **Message chunking** — Long replies split at Slack's 4000-char limit
- **File attachments** — Send and receive files
- **Reactions & message editing** — React to messages, edit previously sent messages
- **Group/channel support** — Opt in specific channels with mention-triggering
- **Typing indicator** — Show processing state in Slack

### Slack App Setup

1. Go to [Slack API Apps](https://api.slack.com/apps) and click **Create New App** > **From scratch**
2. Name your app (e.g., `Claude Code Bot`) and select your workspace
3. Enable **Socket Mode** under **Settings > Socket Mode** and generate an **App-Level Token** with `connections:write` scope (starts with `xapp-`)
4. Under **Features > Event Subscriptions**, enable events and subscribe to:
   - `message.im` (Direct messages)
   - `app_mention` (Mentions in channels)
5. Under **Features > OAuth & Permissions**, add these Bot Token Scopes:
   - `chat:write` — Send messages
   - `im:history` — Read DM history
   - `im:read` — View DMs
   - `app_mentions:read` — Read mentions
   - `users:read` — Read user info
   - `reactions:write` — Add reactions
   - `files:read` — Access shared files
   - `files:write` — Upload files
6. Install the app to your workspace and copy the **Bot User OAuth Token** (starts with `xoxb-`)

### Installation

Install the plugin:

```
/plugin install slack@claude-plugins-official
```

Configure tokens:

```
/slack:configure <bot-token> <app-token>
```

Tokens are saved to `~/.claude/channels/slack/.env`. You can also set environment variables before launching Claude Code:

```bash
export SLACK_BOT_TOKEN=xoxb-...
export SLACK_APP_TOKEN=xapp-...
```

Start with the channel enabled:

```bash
claude --channels plugin:slack@claude-plugins-official
```

### Pairing

1. Send a DM to your bot in Slack
2. The bot replies with a pairing code
3. In Claude Code, run:
   ```
   /slack:access pair <code>
   ```
4. Lock down access:
   ```
   /slack:access policy allowlist
   ```

Messages from senders not on the allowlist are silently dropped.

### Message Format

Messages from Slack arrive in Claude Code as:

```xml
<channel source="slack" chat_id="D67890" message_id="1234567890.123456" user="minsu" user_id="U12345" ts="2026-03-20T10:00:00.000Z">
Hello Claude!
</channel>
```

### Tools

| Tool | Description |
| ---- | ----------- |
| `reply` | Send a message back to Slack. Supports `reply_to` for threading and `files` for attachments. |
| `react` | Add an emoji reaction to a Slack message. |
| `edit_message` | Edit a previously sent message. |
| `fetch_messages` | Fetch recent messages from a Slack channel. |
| `download_attachment` | Download file attachments from a message to local inbox. |

### Local Development

Register the server in `.mcp.json`:

```json
{
  "mcpServers": {
    "slack": { "command": "bun", "args": ["./channels/slack/server.ts"] }
  }
}
```

Start Claude Code with the development flag:

```bash
claude --dangerously-load-development-channels server:slack
```

---

## Adding a New Channel

To add a new channel, create a `channels/<platform>/` directory following the reference implementation patterns:

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

Minsu Lee ([@amondnet](https://github.com/amondnet))