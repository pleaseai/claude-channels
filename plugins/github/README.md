# GitHub Channel for Claude Code

A two-way [channel](https://code.claude.com/docs/en/channels) plugin that bridges **GitHub issue/PR @mention comments** into a running Claude Code session and lets Claude reply, react, and edit comments back.

By default the channel **polls** the GitHub REST API with a Personal Access Token (the same model the Telegram/Discord channels use) — it runs locally with no public URL. It can also run in **webhook mode** (opt-in): a GitHub App + a local signed webhook receiver exposed through a Cloudflare tunnel, for real-time delivery without poll-interval latency. Polling stays the default; see [Webhook transport](#webhook-transport-github-app--cloudflare-tunnel).

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

## Webhook transport (GitHub App + Cloudflare tunnel)

An opt-in alternative to polling: GitHub pushes `issue_comment` events to a local
receiver in real time. Set `CLAUDE_GITHUB_TRANSPORT=webhook` to enable it. Polling
remains the default — existing setups are unaffected.

**Prerequisites**

- [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
  installed on the host (the channel spawns it as a subprocess).
- A **GitHub App** you create manually, with **Issues** and **Pull requests**
  read & write on the watched repos, a **webhook secret**, and subscribed to the
  **Issue comment** event. Install it on the repos and note the **installation ID**.

**Configure** (`~/.claude/channels/github/.env`, mode `0600`):

```
CLAUDE_GITHUB_TRANSPORT=webhook
CLAUDE_GITHUB_APP_ID=123456
CLAUDE_GITHUB_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----
CLAUDE_GITHUB_APP_INSTALLATION_ID=987654
CLAUDE_GITHUB_WEBHOOK_SECRET=<random-string>
CLAUDE_GITHUB_REPOS=owner/repo,owner/repo2
```

The private key may be a single line with literal `\n` escapes (as above) or a
real multi-line PEM.

**Tunnel options** (default is a zero-config quick tunnel):

- `CLAUDE_GITHUB_TUNNEL_MODE=quick` (default) — ephemeral `*.trycloudflare.com`
  URL, no Cloudflare account needed.
- `CLAUDE_GITHUB_TUNNEL_MODE=named` — persistent tunnel; also set
  `CLAUDE_GITHUB_TUNNEL_NAME` and `CLAUDE_GITHUB_TUNNEL_HOSTNAME`.
- `CLAUDE_GITHUB_WEBHOOK_PORT=8765` — local receiver port (cloudflared forwards
  to it).
- `CLAUDE_GITHUB_MENTION=<handle>` — defaults to the App's bot login
  (`<app-slug>[bot]`).

On startup the channel brings up the receiver, opens the tunnel, and **registers
the tunnel URL as the App's webhook** automatically (so ephemeral quick-tunnel
URLs work with no manual step). Inbound payloads are verified against
`CLAUDE_GITHUB_WEBHOOK_SECRET` (`X-Hub-Signature-256`); the same sender allowlist,
watched-repo gating, and dedup as poll mode apply.

> Deploying the receiver to Cloudflare as a hosted Worker/service is a planned
> future enhancement and not part of this transport.

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
