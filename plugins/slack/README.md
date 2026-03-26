# claude-channel-slack

Slack channel plugin for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Bridges a Slack workspace with Claude Code sessions via MCP — each session gets a dedicated thread for isolated two-way messaging.

## Quick Start

### 1. Create a Slack App

Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps) with:

- **Socket Mode** enabled (generates `xapp-` app token)
- **Bot Token Scopes**: `chat:write`, `users:read`, `reactions:write`, `files:read`, `files:write`, `app_mentions:read`
- **Bot Events**: `app_mention`
- For **channel mode**: add scopes `channels:history`, `channels:read` and event `message.channels`
- For **DM mode**: add scopes `im:history`, `im:read`, `im:write` and event `message.im`; enable **App Home > Messages Tab**

> See the [full Slack app setup guide](https://claude-channels.pleaseai.dev/getting-started/slack-setup) for step-by-step instructions.

### 2. Configure Credentials

Choose one of two modes:

**Channel mode** — threads in a shared channel:
```bash
mkdir -p ~/.claude/channels/slack
cat > ~/.claude/channels/slack/.env << 'EOF'
CLAUDE_SLACK_BOT_TOKEN=xoxb-your-bot-token
CLAUDE_SLACK_APP_TOKEN=xapp-your-app-token
CLAUDE_SLACK_CHANNEL_ID=C0123456789
EOF
```
Then invite the bot to the channel: `/invite @YourBotName`

**DM mode** — threads in a direct message with the bot:
```bash
mkdir -p ~/.claude/channels/slack
cat > ~/.claude/channels/slack/.env << 'EOF'
CLAUDE_SLACK_BOT_TOKEN=xoxb-your-bot-token
CLAUDE_SLACK_APP_TOKEN=xapp-your-app-token
CLAUDE_SLACK_DM_USER_ID=UYourSlackUserID
EOF
```
Get your user ID from Slack: **Profile > ⋮ > Copy member ID**

### 3. Register MCP Server

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

### 4. Start a Session

Launch Claude Code. The plugin creates a new thread in the configured channel (or DM). Send messages in that thread to interact with Claude.

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
| `CLAUDE_SLACK_BOT_TOKEN` | yes | Bot User OAuth Token (`xoxb-...`) |
| `CLAUDE_SLACK_APP_TOKEN` | yes | App-Level Token with `connections:write` (`xapp-...`) |
| `CLAUDE_SLACK_CHANNEL_ID` | one of these | Channel ID for channel thread mode (`C...`) |
| `CLAUDE_SLACK_DM_USER_ID` | one of these | Slack user ID for DM thread mode (`U...`) |

Set either `CLAUDE_SLACK_CHANNEL_ID` (channel mode) or `CLAUDE_SLACK_DM_USER_ID` (DM mode). If both are set, channel mode takes precedence.

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
