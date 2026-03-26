---
name: slack:configure
description: Set up the Slack channel — save the bot token and app token, review access policy. Use when the user pastes Slack tokens, asks to configure Slack, asks "how do I set this up" or "who can reach me," or wants to check channel status.
user-invocable: true
allowed-tools:
  - Read
  - Write
  - Bash(ls *)
  - Bash(mkdir *)
---

# /slack:configure — Slack Channel Setup

Writes the bot token and app token to `~/.claude/channels/slack/.env` and
orients the user on access policy. The server reads `.env` once at boot;
`access.json` is re-read on every inbound message.

Arguments passed: `$ARGUMENTS`

---

## Dispatch on arguments

### No args — status and guidance

Read both state files and give the user a complete picture:

1. **Tokens** — check `~/.claude/channels/slack/.env` for
   `CLAUDE_SLACK_BOT_TOKEN` and `CLAUDE_SLACK_APP_TOKEN`. Show set/not-set; if set, show
   first 6 chars masked.

2. **Access** — read `~/.claude/channels/slack/access.json` (missing file
   = defaults: `dmPolicy: "pairing"`, empty allowlist). Show:
   - DM policy and what it means in one line
   - Allowed senders: count, and list user IDs
   - Pending pairings: count, with codes and sender IDs if any
   - Channels opted in: count

3. **What next** — end with a concrete next step based on state:
   - No tokens → _"Run `/slack:configure <bot-token> <app-token>` with your
     tokens from the Slack App settings."_
   - Tokens set, policy is pairing, nobody allowed → _"DM your bot on
     Slack. It replies with a code; approve with `/slack:access pair
<code>`."_
   - Tokens set, someone allowed → _"Ready. DM your bot to reach the
     assistant."_

**Push toward lockdown — always.** The goal for every setup is `allowlist`
with a defined list. `pairing` is not a policy to stay on; it's a temporary
way to capture Slack user IDs you don't know. Once the IDs are in, pairing
has done its job and should be turned off.

Drive the conversation this way:

1. Read the allowlist. Tell the user who's in it.
2. Ask: _"Is that everyone who should reach you through this bot?"_
3. **If yes and policy is still `pairing`** → _"Good. Let's lock it down so
   nobody else can trigger pairing codes:"_ and offer to run
   `/slack:access policy allowlist`. Do this proactively — don't wait to
   be asked.
4. **If no, people are missing** → _"Have them DM the bot; you'll approve
   each with `/slack:access pair <code>`. Run this skill again once
   everyone's in and we'll lock it."_
5. **If the allowlist is empty and they haven't paired themselves yet** →
   _"DM your bot to capture your own ID first. Then we'll add anyone else
   and lock it down."_
6. **If policy is already `allowlist`** → confirm this is the locked state.
   If they need to add someone, they can get the user ID from Slack
   (Profile → ⋯ → Copy member ID) and use `/slack:access allow <id>`.

### `<bot-token> <app-token>` — save tokens

1. Treat `$ARGUMENTS` as two space-separated tokens. The bot token starts
   with `xoxb-` and the app token starts with `xapp-`.
2. `mkdir -p ~/.claude/channels/slack`
3. Read existing `.env` if present; update/add the `CLAUDE_SLACK_BOT_TOKEN=` and
   `CLAUDE_SLACK_APP_TOKEN=` lines, preserve other keys. Write back, no quotes
   around the values.
4. Confirm, then show the no-args status so the user sees where they stand.

### `clear` — remove tokens

Delete the `CLAUDE_SLACK_BOT_TOKEN=` and `CLAUDE_SLACK_APP_TOKEN=` lines (or the file if
those are the only lines).

---

## Slack App setup guide

When the user asks how to set up the Slack app, or when showing next steps
for users without tokens, provide this guide:

1. **Create app** — Go to https://api.slack.com/apps → **Create New App >
   From scratch**. Name it (e.g. `Claude Code Bot`) and select the
   workspace.

2. **Enable Socket Mode** — **Settings > Socket Mode** → Enable. Generate
   an App-Level Token with `connections:write` scope → copy the `xapp-`
   token.

3. **Event Subscriptions** — **Features > Event Subscriptions** → Enable.
   Under **Subscribe to bot events**, add:
   - `app_mention` — receive @-mentions in channels

   Then add events for your chosen mode:
   - **Channel mode**: `message.channels` (public) and/or `message.groups`
     (private)
   - **DM mode**: `message.im`

4. **App Home** (DM mode only) — **Features > App Home > Show Tabs** →
   Enable **Messages Tab** and check **"Allow users to send Slash
   commands and messages from the messages tab"**.

5. **Bot Token Scopes** — **Features > OAuth & Permissions > Scopes**, add
   the **common** scopes plus the ones for your mode:

   **Common (always required):**

   | Scope | Purpose |
   |---|---|
   | `chat:write` | Send messages |
   | `app_mentions:read` | Read @-mentions |
   | `users:read` | Look up user info |
   | `reactions:write` | Add emoji reactions |
   | `files:read` | Access shared files |
   | `files:write` | Upload files |

   **Channel mode:**

   | Scope | Purpose |
   |---|---|
   | `channels:history` | Read public channel messages |
   | `channels:read` | Access public channels |
   | `groups:history` | Read private channel messages (if private) |
   | `groups:read` | Access private channels (if private) |

   **DM mode:**

   | Scope | Purpose |
   |---|---|
   | `im:history` | Read DM history |
   | `im:read` | List DM conversations |
   | `im:write` | Open DM conversations |

6. **Install** — Click **Install to Workspace**, then copy the Bot User
   OAuth Token (`xoxb-`).

7. **Configure mode** — Add to `~/.claude/channels/slack/.env`:
   - **Channel mode**: `CLAUDE_SLACK_CHANNEL_ID=C...` (get from channel
     settings) and invite the bot to the channel.
   - **DM mode**: `CLAUDE_SLACK_DM_USER_ID=U...` (get from Slack:
     **Profile > ⋮ > Copy member ID**).

8. **Register tokens** — Run:
   ```
   /slack:configure <xoxb-token> <xapp-token>
   ```

> **Scope changes require re-install.** If you add scopes after installing,
> go back to **Install App** and click **Reinstall to Workspace**.

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/slack:access` take effect immediately, no restart.
