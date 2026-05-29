---
name: github:configure
description: Configure GitHub channel credentials and watched repositories (Personal Access Token, repo list). Use when the user wants to set up GitHub credentials, configure the token, change watched repositories, or check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
  - Bash(chmod *)
---

# /github:configure — GitHub Channel Setup

Writes the Personal Access Token and watched repositories to
`~/.claude/channels/github/.env`. The server reads `.env` once at boot;
`access.json` is re-read on every poll cycle.

Arguments passed: `$ARGUMENTS`

## Dispatch on arguments

### No args — status and guidance

Read `~/.claude/channels/github/.env` (missing file = not configured) and show:

1. **Token** — whether `CLAUDE_GITHUB_TOKEN` is set (mask all but the first 8
   chars; never echo the full token).
2. **Repos** — the `CLAUDE_GITHUB_REPOS` value, or "none configured".
3. **Optional** — `CLAUDE_GITHUB_MENTION`, `CLAUDE_GITHUB_POLL_INTERVAL_MS` if set.
4. **Access** — read `access.json` and show `mode` + allowlist count.
5. **Next step** — if no token: _"Run `/github:configure <token> owner/repo`."_
   If configured: _"Allowlist senders with `/github:access allow <login>`, then
   restart with `--channels plugin:github@<marketplace>`."_

### `<token> [owner/repo,owner/repo2]` — save credentials

1. `mkdir -p ~/.claude/channels/github`
2. Read existing `.env`; update/add `CLAUDE_GITHUB_TOKEN=<token>`. If a repo list
   was provided, set `CLAUDE_GITHUB_REPOS=<list>`; otherwise preserve the
   existing value. Preserve other keys. No quotes around values.
3. **Set the file permission with `chmod 600 ~/.claude/channels/github/.env`** —
   the `Write` tool creates the file under the default umask (0644 on macOS),
   which leaves the PAT world-readable. This `chmod` step is mandatory and must
   run immediately after writing, every time `.env` is created or updated.
4. Confirm (masked), then show the no-args status.

### `repos <owner/repo,...>` — set watched repositories

Read `.env`, set `CLAUDE_GITHUB_REPOS`, write back, then re-run
`chmod 600 ~/.claude/channels/github/.env` (Write resets the mode), confirm.

### `clear` — remove credentials

Delete the `CLAUDE_GITHUB_TOKEN` and `CLAUDE_GITHUB_REPOS` lines (or the file if
they are the only contents).

## PAT setup guide

When the user asks how to create the token:

1. Go to **GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. **Repository access** → select the repos you want to watch.
3. **Permissions → Repository**:
   - **Issues**: Read and write
   - **Pull requests**: Read and write
   - **Metadata**: Read (auto-selected)
4. Generate, copy the `github_pat_...` token, and run
   `/github:configure <token> owner/repo`.

> A classic `ghp_...` token with `repo` scope also works but is broader than
> necessary; prefer fine-grained.

## Webhook mode (GitHub App + Cloudflare tunnel)

The channel has two inbound transports, selected by `CLAUDE_GITHUB_TRANSPORT`
(default `poll`). The PAT flow above is poll mode. **Webhook mode** uses a GitHub
App + a Cloudflare tunnel for real-time delivery; the user creates the App
manually and supplies its credentials. When the user wants webhook mode, write
these keys to `~/.claude/channels/github/.env` (then `chmod 600`):

```
CLAUDE_GITHUB_TRANSPORT=webhook
CLAUDE_GITHUB_APP_ID=<app id>
CLAUDE_GITHUB_APP_PRIVATE_KEY=<PEM; single line with \n escapes is fine>
CLAUDE_GITHUB_APP_INSTALLATION_ID=<installation id>
CLAUDE_GITHUB_WEBHOOK_SECRET=<random string>
CLAUDE_GITHUB_REPOS=owner/repo,owner/repo2
```

Optional tunnel keys:

- `CLAUDE_GITHUB_TUNNEL_MODE=quick|named` (default `quick`)
- `CLAUDE_GITHUB_TUNNEL_NAME`, `CLAUDE_GITHUB_TUNNEL_HOSTNAME` (named mode only)
- `CLAUDE_GITHUB_WEBHOOK_PORT=8765` (local receiver port)
- `CLAUDE_GITHUB_MENTION=<handle>` (defaults to `<app-slug>[bot]`)

GitHub App requirements: **Issues** + **Pull requests** read & write on the
watched repos, a **webhook secret**, and a subscription to the **Issue comment**
event. `cloudflared` must be installed on the host. The channel registers the
tunnel URL as the App's webhook automatically at startup. Never echo the private
key or webhook secret back to the user (mask like the token).

When showing no-args status, also report `CLAUDE_GITHUB_TRANSPORT` and, in
webhook mode, whether the App credentials (app id / private key / installation id
/ webhook secret) are present (masked).

## Implementation notes

- The server reads `.env` once at boot — token/repo changes need a session
  restart or `/reload-plugins`. Say so after saving.
- The server supports `CLAUDE_GITHUB_STATE_DIR` to override the state directory
  (used in tests).
- Never print the full token back to the user.
