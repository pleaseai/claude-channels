# claude-channel-slack

Slack channel plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Bridges a Slack workspace with Claude Code sessions via MCP — each session gets a dedicated thread for isolated two-way messaging.

## Quick Start

### 1. Create a Slack App

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with:

- **Socket Mode** enabled (generates `xapp-` app token)
- **Bot Token Scopes**: `channels:history`, `channels:read`, `chat:write`, `files:read`, `files:write`, `reactions:write`, `app_mentions:read`
- **Bot Events**: `message.channels`, `app_mention`

> See the [full Slack app setup guide](https://claude-channels.pleaseai.dev/getting-started/slack-setup) for step-by-step instructions.

### 2. Configure Credentials

```bash
mkdir -p ~/.claude/channels/slack
cat > ~/.claude/channels/slack/.env << 'EOF'
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
SLACK_CHANNEL_ID=C0123456789
EOF
```

### 3. Invite the Bot

```
/invite @YourBotName
```

in the Slack channel matching `SLACK_CHANNEL_ID`.

### 4. Register MCP Server

Add to `~/.claude/settings.json` (global) or `.mcp.json` (per-project):

```json
{
  "mcpServers": {
    "slack-channel": {
      "command": "bun",
      "args": ["run", "/path/to/claude-channels/plugins/slack/server.ts"]
    }
  }
}
```

### 5. Start a Session

Launch Claude Code. The plugin creates a new thread in the configured channel. Send messages in that thread to interact with Claude.

## Tools

| Tool | Description |
|------|-------------|
| `reply` | Send a message (+ optional file attachments) to the thread |
| `react` | Add an emoji reaction to a message |
| `edit_message` | Edit a previously sent message |
| `download_attachment` | Download file attachments from a message |
| `fetch_messages` | Fetch recent message history from the thread |

## How It Works

- Each session creates a **dedicated thread** — all communication is scoped to it
- Inbound messages from the thread are forwarded to Claude Code as MCP notifications
- Claude uses the tools above to reply, react, and manage the conversation
- Messages outside the bound thread are ignored

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_BOT_TOKEN` | yes | Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | yes | App-Level Token with `connections:write` (`xapp-...`) |
| `SLACK_CHANNEL_ID` | yes | Channel ID where threads are created (`C...`) |

Credentials are loaded from `~/.claude/channels/slack/.env`. Environment variables take precedence over the file.

## Documentation

For detailed guides, see the [docs site](https://claude-channels.pleaseai.dev):

- [Slack Setup Guide](https://claude-channels.pleaseai.dev/getting-started/slack-setup) — Creating the Slack app, configuring scopes and events
- [Usage Guide](https://claude-channels.pleaseai.dev/getting-started/usage) — Messaging, attachments, tools reference, troubleshooting

## Development

```bash
bun run --filter claude-channel-slack dev   # Run in dev mode
bun test plugins/slack/                     # Run tests
```
