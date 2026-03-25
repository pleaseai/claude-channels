---
name: configure
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
   `SLACK_BOT_TOKEN` and `SLACK_APP_TOKEN`. Show set/not-set; if set, show
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
3. Read existing `.env` if present; update/add the `SLACK_BOT_TOKEN=` and
   `SLACK_APP_TOKEN=` lines, preserve other keys. Write back, no quotes
   around the values.
4. Confirm, then show the no-args status so the user sees where they stand.

### `clear` — remove tokens

Delete the `SLACK_BOT_TOKEN=` and `SLACK_APP_TOKEN=` lines (or the file if
those are the only lines).

---

## Implementation notes

- The channels dir might not exist if the server hasn't run yet. Missing file
  = not configured, not an error.
- The server reads `.env` once at boot. Token changes need a session restart
  or `/reload-plugins`. Say so after saving.
- `access.json` is re-read on every inbound message — policy changes via
  `/slack:access` take effect immediately, no restart.
