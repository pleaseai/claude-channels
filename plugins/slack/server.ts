#!/usr/bin/env bun
/**
 * Slack channel for Claude Code — thread-bound session.
 *
 * Each session creates a dedicated thread in the channel specified by
 * SLACK_CHANNEL_ID. All inbound/outbound messages are scoped to that thread.
 * State lives in ~/.claude/channels/slack/.
 */

import { Buffer } from 'node:buffer'
import {
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, sep } from 'node:path'
import process from 'node:process'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { SocketModeClient } from '@slack/socket-mode'
import { WebClient } from '@slack/web-api'

/* ------------------------------------------------------------------ */
/*  Module-scope regex patterns                                        */
/* ------------------------------------------------------------------ */

const RE_ENV_LINE = /^(\w+)=(.*)$/
const RE_LEADING_NEWLINES = /^\n+/
const RE_EXT_SANITIZE = /[^a-z0-9]/gi
const RE_NAME_SANITIZE = /[[\]\r\n;]/g
const RE_NEWLINES = /[\r\n]+/g

/* ------------------------------------------------------------------ */
/*  State paths                                                        */
/* ------------------------------------------------------------------ */

const STATE_DIR = join(homedir(), '.claude', 'channels', 'slack')
const ENV_FILE = join(STATE_DIR, '.env')
const INBOX_DIR = join(STATE_DIR, 'inbox')

/* ------------------------------------------------------------------ */
/*  Token and channel loading                                          */
/* ------------------------------------------------------------------ */

// Load ~/.claude/channels/slack/.env into process.env. Real env wins.
try {
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(RE_ENV_LINE)
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2]
  }
}
catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
    process.stderr.write(`slack channel: failed to read ${ENV_FILE}: ${err}\n`)
}

const BOT_TOKEN = process.env.SLACK_BOT_TOKEN
const APP_TOKEN = process.env.SLACK_APP_TOKEN
const CHANNEL_ID = process.env.SLACK_CHANNEL_ID

if (!BOT_TOKEN || !APP_TOKEN) {
  process.stderr.write(
    `slack channel: SLACK_BOT_TOKEN and SLACK_APP_TOKEN required\n`
    + `  set in ${ENV_FILE}\n`
    + `  format:\n`
    + `    SLACK_BOT_TOKEN=xoxb-...\n`
    + `    SLACK_APP_TOKEN=xapp-...\n`,
  )
  process.exit(1)
}

if (!CHANNEL_ID) {
  process.stderr.write(
    `slack channel: SLACK_CHANNEL_ID required\n`
    + `  set via environment variable or in ${ENV_FILE}\n`
    + `  format:\n`
    + `    SLACK_CHANNEL_ID=C...\n`,
  )
  process.exit(1)
}

// After the guard above, CHANNEL_ID is guaranteed to be a non-empty string.
// Re-bind as const to help TypeScript narrow the type.
const BOUND_CHANNEL: string = CHANNEL_ID

/* ------------------------------------------------------------------ */
/*  Slack clients                                                      */
/* ------------------------------------------------------------------ */

const web = new WebClient(BOT_TOKEN)
const socket = new SocketModeClient({ appToken: APP_TOKEN })

// Resolve bot user ID at startup for mention detection.
let botUserId = ''

/* ------------------------------------------------------------------ */
/*  Thread binding state                                               */
/* ------------------------------------------------------------------ */

/** The ts of the thread's parent message — set at startup. */
let boundThreadTs = ''

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SlackMessage {
  user: string
  channel: string
  ts: string
  text: string
  thread_ts?: string
  channel_type?: string
  files?: SlackFile[]
}

interface SlackFile {
  id: string
  name: string
  mimetype: string
  size: number
  url_private_download?: string
  url_private?: string
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MAX_CHUNK_LIMIT = 4000
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024

function assertSendable(f: string): void {
  let real: string, stateReal: string
  try {
    real = realpathSync(f)
    stateReal = realpathSync(STATE_DIR)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      return
    throw new Error(`cannot verify file is safe to send: ${f}: ${err}`)
  }
  const inbox = join(stateReal, 'inbox')
  if (real.startsWith(stateReal + sep) && !real.startsWith(inbox + sep)) {
    throw new Error(`refusing to send channel state: ${f}`)
  }
}

const recentSentIds = new Set<string>()
const RECENT_SENT_CAP = 200

function noteSent(ts: string): void {
  recentSentIds.add(ts)
  if (recentSentIds.size > RECENT_SENT_CAP) {
    const first = recentSentIds.values().next().value
    if (first)
      recentSentIds.delete(first)
  }
}

/* ------------------------------------------------------------------ */
/*  Text chunking                                                      */
/* ------------------------------------------------------------------ */

function chunk(text: string, limit: number, mode: 'length' | 'newline'): string[] {
  if (text.length <= limit)
    return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > limit) {
    let cut = limit
    if (mode === 'newline') {
      const para = rest.lastIndexOf('\n\n', limit)
      const line = rest.lastIndexOf('\n', limit)
      const space = rest.lastIndexOf(' ', limit)
      cut = para > limit / 2 ? para : line > limit / 2 ? line : space > 0 ? space : limit
    }
    out.push(rest.slice(0, cut))
    rest = rest.slice(cut).replace(RE_LEADING_NEWLINES, '')
  }
  if (rest)
    out.push(rest)
  return out
}

/* ------------------------------------------------------------------ */
/*  File download                                                      */
/* ------------------------------------------------------------------ */

async function downloadFile(file: SlackFile): Promise<string> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`file too large: ${(file.size / 1024 / 1024).toFixed(1)}MB, max ${MAX_ATTACHMENT_BYTES / 1024 / 1024}MB`)
  }
  const url = file.url_private_download ?? file.url_private
  if (!url)
    throw new Error(`no download URL for file ${file.id}`)

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${BOT_TOKEN}` },
  })
  if (!res.ok)
    throw new Error(`download failed: ${res.status} ${res.statusText}`)
  const buf = Buffer.from(await res.arrayBuffer())

  const name = file.name ?? file.id
  const rawExt = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : 'bin'
  const ext = rawExt.replace(RE_EXT_SANITIZE, '') || 'bin'
  const path = join(INBOX_DIR, `${Date.now()}-${file.id}.${ext}`)
  const tmp = `${path}.tmp`
  mkdirSync(INBOX_DIR, { recursive: true, mode: 0o700 })
  writeFileSync(tmp, buf, { mode: 0o600 })
  renameSync(tmp, path)
  return path
}

function safeFileName(file: SlackFile): string {
  return (file.name ?? file.id).replace(RE_NAME_SANITIZE, '_')
}

/* ------------------------------------------------------------------ */
/*  Thread guard                                                       */
/* ------------------------------------------------------------------ */

function isInBoundThread(msg: SlackMessage): boolean {
  if (!boundThreadTs)
    return false
  // Accept messages that are replies in the bound thread
  return msg.thread_ts === boundThreadTs
}

async function assertInBoundThread(messageTs: string): Promise<void> {
  const result = await web.conversations.replies({
    channel: BOUND_CHANNEL,
    ts: boundThreadTs,
  })
  const found = result.messages?.some(m => m.ts === messageTs)
  if (!found)
    throw new Error(`message ${messageTs} is not in the bound thread`)
}

/* ------------------------------------------------------------------ */
/*  MCP server                                                         */
/* ------------------------------------------------------------------ */

const mcp = new Server(
  { name: 'slack', version: '1.0.0' },
  {
    capabilities: { tools: {}, experimental: { 'claude/channel': {} } },
    instructions: [
      'This session is bound to a single Slack thread. All messages you receive come from that thread, and all replies go back to it.',
      '',
      'Messages from Slack arrive as <channel source="slack" chat_id="..." message_id="..." user="..." ts="...">. If the tag has attachment_count, the attachments attribute lists name/type/size — call download_attachment(message_id) to fetch them.',
      '',
      'Reply with the reply tool — just pass text (and optional files). The thread is automatic. Use react to add emoji reactions and edit_message to update a message you previously sent.',
      '',
      'fetch_messages pulls history from the bound thread. Slack\'s search API requires user tokens (not bot tokens), so if the user asks you to find an old message, fetch more history or ask them roughly when it was.',
    ].join('\n'),
  },
)

/* ------------------------------------------------------------------ */
/*  Tool definitions                                                   */
/* ------------------------------------------------------------------ */

mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'reply',
      description:
        'Reply in the bound Slack thread. Optionally pass files (absolute paths) to attach.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          text: { type: 'string' },
          files: {
            type: 'array',
            items: { type: 'string' },
            description: 'Absolute file paths to attach. Max 10 files, 25MB each.',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'react',
      description: 'Add an emoji reaction to a message in the bound thread. Use Slack emoji names without colons (e.g. "thumbsup").',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message_id: { type: 'string', description: 'Message ts to react to.' },
          emoji: { type: 'string', description: 'Emoji name without colons (e.g. "thumbsup").' },
        },
        required: ['message_id', 'emoji'],
      },
    },
    {
      name: 'edit_message',
      description: 'Edit a message the bot previously sent in the bound thread.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message_id: { type: 'string', description: 'Message ts to edit.' },
          text: { type: 'string' },
        },
        required: ['message_id', 'text'],
      },
    },
    {
      name: 'download_attachment',
      description: 'Download attachments from a specific message in the bound thread. Returns file paths ready to Read.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          message_id: { type: 'string', description: 'Message ts to download files from.' },
        },
        required: ['message_id'],
      },
    },
    {
      name: 'fetch_messages',
      description:
        'Fetch recent messages from the bound thread. Returns oldest-first with message ts values.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          limit: {
            type: 'number',
            description: 'Max messages (default 20, max 100).',
          },
        },
      },
    },
  ],
}))

/* ------------------------------------------------------------------ */
/*  Tool handlers                                                      */
/* ------------------------------------------------------------------ */

mcp.setRequestHandler(CallToolRequestSchema, async (req) => {
  const args = (req.params.arguments ?? {}) as Record<string, unknown>
  try {
    switch (req.params.name) {
      case 'reply': {
        const text = args.text as string
        const files = (args.files as string[] | undefined) ?? []

        for (const f of files) {
          assertSendable(f)
          const st = statSync(f)
          if (st.size > MAX_ATTACHMENT_BYTES) {
            throw new Error(`file too large: ${f} (${(st.size / 1024 / 1024).toFixed(1)}MB, max 25MB)`)
          }
        }
        if (files.length > 10)
          throw new Error('max 10 attachments per message')

        const chunks = chunk(text, MAX_CHUNK_LIMIT, 'length')
        const sentTs: string[] = []

        try {
          for (let i = 0; i < chunks.length; i++) {
            // Upload files with the first chunk
            if (i === 0 && files.length > 0) {
              for (const f of files) {
                const fileContent = readFileSync(f)
                const fileName = f.split('/').pop() ?? 'file'
                await web.files.uploadV2({
                  channel_id: BOUND_CHANNEL,
                  file: fileContent,
                  filename: fileName,
                  thread_ts: boundThreadTs,
                } as unknown as Parameters<typeof web.files.uploadV2>[0])
              }
            }

            const sent = await web.chat.postMessage({
              channel: BOUND_CHANNEL,
              text: chunks[i],
              thread_ts: boundThreadTs,
            })

            if (sent.ts) {
              noteSent(sent.ts)
              sentTs.push(sent.ts)
            }
          }
        }
        catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          throw new Error(`reply failed after ${sentTs.length} of ${chunks.length} chunk(s) sent: ${msg}`)
        }

        const result
          = sentTs.length === 1
            ? `sent (ts: ${sentTs[0]})`
            : `sent ${sentTs.length} parts (ts: ${sentTs.join(', ')})`
        return { content: [{ type: 'text' as const, text: result }] }
      }

      case 'fetch_messages': {
        const msgLimit = Math.max(1, Math.min((args.limit as number) ?? 20, 100))

        const result = await web.conversations.replies({
          channel: BOUND_CHANNEL,
          ts: boundThreadTs,
          limit: msgLimit,
        })

        // Skip the parent message (first in replies)
        const msgs = (result.messages ?? []).filter(m => m.ts !== boundThreadTs)
        const out
          = msgs.length === 0
            ? '(no messages)'
            : msgs
                .map((m) => {
                  const who = m.user === botUserId ? 'me' : (m.user ?? 'unknown')
                  const fileCount = m.files?.length ?? 0
                  const atts = fileCount > 0 ? ` +${fileCount}att` : ''
                  const text = (m.text ?? '').replace(RE_NEWLINES, ' ⏎ ')
                  const ts = m.ts ?? ''
                  return `[${ts}] ${who}: ${text}  (ts: ${ts}${atts})`
                })
                .join('\n')
        return { content: [{ type: 'text' as const, text: out }] }
      }

      case 'react': {
        const messageId = args.message_id as string
        await assertInBoundThread(messageId)
        await web.reactions.add({
          channel: BOUND_CHANNEL,
          timestamp: messageId,
          name: args.emoji as string,
        })
        return { content: [{ type: 'text' as const, text: 'reacted' }] }
      }

      case 'edit_message': {
        const messageId = args.message_id as string
        await assertInBoundThread(messageId)
        const edited = await web.chat.update({
          channel: BOUND_CHANNEL,
          ts: messageId,
          text: args.text as string,
        })
        return { content: [{ type: 'text' as const, text: `edited (ts: ${edited.ts})` }] }
      }

      case 'download_attachment': {
        // Fetch from thread replies
        const messageTs = args.message_id as string
        const result = await web.conversations.replies({
          channel: BOUND_CHANNEL,
          ts: boundThreadTs,
        })
        const msg = result.messages?.find(m => m.ts === messageTs)
        if (!msg?.files?.length) {
          return { content: [{ type: 'text' as const, text: 'message has no attachments' }] }
        }

        const lines: string[] = []
        for (const f of msg.files) {
          const slackFile: SlackFile = {
            id: f.id ?? 'unknown',
            name: f.name ?? 'file',
            mimetype: f.mimetype ?? 'application/octet-stream',
            size: f.size ?? 0,
            url_private_download: f.url_private_download,
            url_private: f.url_private,
          }
          const path = await downloadFile(slackFile)
          const kb = (slackFile.size / 1024).toFixed(0)
          lines.push(`  ${path}  (${safeFileName(slackFile)}, ${slackFile.mimetype}, ${kb}KB)`)
        }
        return {
          content: [{ type: 'text' as const, text: `downloaded ${lines.length} attachment(s):\n${lines.join('\n')}` }],
        }
      }

      default:
        return {
          content: [{ type: 'text' as const, text: `unknown tool: ${req.params.name}` }],
          isError: true,
        }
    }
  }
  catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      content: [{ type: 'text' as const, text: `${req.params.name} failed: ${msg}` }],
      isError: true,
    }
  }
})

/* ------------------------------------------------------------------ */
/*  Inbound deduplication                                              */
/* ------------------------------------------------------------------ */

const recentInboundTs = new Set<string>()
const RECENT_INBOUND_CAP = 200

function dedup(ts: string): boolean {
  if (recentInboundTs.has(ts))
    return false
  recentInboundTs.add(ts)
  if (recentInboundTs.size > RECENT_INBOUND_CAP) {
    const first = recentInboundTs.values().next().value
    if (first)
      recentInboundTs.delete(first)
  }
  return true
}

/* ------------------------------------------------------------------ */
/*  Inbound message handling                                           */
/* ------------------------------------------------------------------ */

async function handleInbound(msg: SlackMessage): Promise<void> {
  if (!dedup(msg.ts))
    return

  // Thread filter — only accept messages in the bound thread
  if (!isInBoundThread(msg))
    return

  // Ignore bot's own messages
  if (botUserId && msg.user === botUserId)
    return

  const chatId = msg.channel

  // List attachments in meta without downloading
  const atts: string[] = []
  if (msg.files) {
    for (const f of msg.files) {
      const kb = (f.size / 1024).toFixed(0)
      atts.push(`${safeFileName(f)} (${f.mimetype}, ${kb}KB)`)
    }
  }

  const content = msg.text || (atts.length > 0 ? '(attachment)' : '')

  mcp.notification({
    method: 'notifications/claude/channel',
    params: {
      content,
      meta: {
        chat_id: chatId,
        message_id: msg.ts,
        user: msg.user,
        user_id: msg.user,
        ts: new Date(Number.parseFloat(msg.ts) * 1000).toISOString(),
        ...(atts.length > 0 ? { attachment_count: String(atts.length), attachments: atts.join('; ') } : {}),
      },
    },
  }).catch((err) => {
    process.stderr.write(`slack channel: failed to deliver message from ${msg.user} in ${chatId}: ${err}\n`)
  })
}

/* ------------------------------------------------------------------ */
/*  Socket Mode event handler                                          */
/* ------------------------------------------------------------------ */

socket.on('message', async ({ event, ack }) => {
  await ack()

  // Ignore bot messages, message_changed, etc.
  if (!event || event.subtype || event.bot_id)
    return
  if (!event.user || (!event.text && !event.files?.length))
    return

  const msg: SlackMessage = {
    user: event.user,
    channel: event.channel,
    ts: event.ts,
    text: event.text ?? '',
    thread_ts: event.thread_ts,
    channel_type: event.channel_type,
    files: event.files,
  }

  handleInbound(msg).catch(e => process.stderr.write(`slack: handleInbound failed: ${e}\n`))
})

// Also handle app_mention events for channel mentions
socket.on('app_mention', async ({ event, ack }) => {
  await ack()

  if (!event || !event.user)
    return

  const msg: SlackMessage = {
    user: event.user,
    channel: event.channel,
    ts: event.ts,
    text: event.text ?? '',
    thread_ts: event.thread_ts,
    channel_type: 'channel',
    files: event.files,
  }

  handleInbound(msg).catch(e => process.stderr.write(`slack: handleInbound (mention) failed: ${e}\n`))
})

/* ------------------------------------------------------------------ */
/*  Startup                                                            */
/* ------------------------------------------------------------------ */

async function main(): Promise<void> {
  await mcp.connect(new StdioServerTransport())

  // Resolve bot user ID
  try {
    const authResult = await web.auth.test()
    botUserId = authResult.user_id ?? ''
    process.stderr.write(`slack channel: connected as ${authResult.user} (${botUserId})\n`)
  }
  catch (err) {
    process.stderr.write(`slack channel: auth.test failed: ${err}\n`)
  }

  // Create the bound thread
  const threadStart = await web.chat.postMessage({
    channel: BOUND_CHANNEL,
    text: `Claude Code session started`,
  })
  if (!threadStart.ts) {
    throw new Error('failed to create thread — no ts returned')
  }
  boundThreadTs = threadStart.ts
  noteSent(boundThreadTs)
  process.stderr.write(`slack channel: bound to thread ${boundThreadTs} in ${BOUND_CHANNEL}\n`)

  await socket.start()
  process.stderr.write('slack channel: Socket Mode connected\n')
}

main().catch((err) => {
  process.stderr.write(`slack channel: startup failed: ${err}\n`)
  process.exit(1)
})
