# GitHub Channel for Claude Code

A two-way [channel](https://code.claude.com/docs/en/channels) plugin that bridges **GitHub issue/PR @mention comments** into a running Claude Code session and lets Claude reply, react, and edit comments back.

Because a local subprocess cannot receive GitHub webhooks, the channel **polls** the GitHub REST API (the same model the Telegram/Discord channels use). It runs locally with no public URL.

## How it works

- **Inbound** — polls watched repositories for new issue and pull-request comments that `@mention` the configured handle, then forwards each as a `<channel source="github">` event.
- **Outbound** — Claude calls `reply` / `react` / `edit_message` / `fetch_messages` to act on the originating thread.
- **Sender gating** — only comments from allowlisted GitHub logins are delivered (gate on the commenter, never the repo).

## Setup

### 1. Create a Personal Access Token

Create a [fine-grained PAT](https://github.com/settings/tokens?type=beta) with access to your watched repositories and these permissions:

- Repository → **Issues**: Read and write
- Repository → **Pull requests**: Read and write
- Repository → **Metadata**: Read

### 2. Configure credentials

```
/github:configure <token> owner/repo,owner/repo2
```

This writes `~/.claude/channels/github/.env` (mode `0600`):

```
CLAUDE_GITHUB_TOKEN=github_pat_...
CLAUDE_GITHUB_REPOS=owner/repo,owner/repo2
```

Optional settings:

- `CLAUDE_GITHUB_MENTION=<handle>` — handle to match (defaults to the token's account login)
- `CLAUDE_GITHUB_POLL_INTERVAL_MS=5000` — poll interval

### 3. Allow senders

```
/github:access allow <github-login>
```

Use `/github:access policy open` to accept any commenter, or `list` to inspect state.

### 4. Run with the channel enabled

During the channels research preview, custom channels need the development flag:

```bash
claude --dangerously-load-development-channels plugin:github@<marketplace>
```

Then `@mention` your handle in a comment on a watched issue/PR — the comment arrives in your session and Claude replies as a comment.

## Tools

| Tool             | Purpose                                                 |
| ---------------- | ------------------------------------------------------- |
| `reply`          | Post a comment to `owner/repo#number`                   |
| `react`          | Add a reaction (`+1`, `eyes`, `rocket`, …) to a comment |
| `edit_message`   | Edit a comment this session posted                      |
| `fetch_messages` | Fetch recent comments from a thread                     |

## State

`~/.claude/channels/github/`

- `.env` — credentials (`0600`)
- `access.json` — sender allowlist + policy
- `cursor.json` — poll cursor (so restarts don't replay old comments)

## Development

```bash
bun install
bun test plugins/github/   # unit + MCP-stdio integration tests
bun run lint
```

## Author

Minsu Lee ([@amondnet](https://github.com/amondnet))
