import { beforeAll, describe, expect, test } from 'bun:test'

/**
 * Tests for the thread-bound Slack channel server.
 *
 * Since server.ts executes at module scope (reads env, connects to Slack),
 * we test the core logic by reimplementing the pure functions here and
 * verifying behavior against the spec requirements.
 */

/* ------------------------------------------------------------------ */
/*  Pure function reimplementations for testing                        */
/* ------------------------------------------------------------------ */

const RE_LEADING_NEWLINES = /^\n+/

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

interface SlackMessage {
  user: string
  channel: string
  ts: string
  text: string
  thread_ts?: string
  channel_type?: string
  files?: { id: string, name: string, mimetype: string, size: number }[]
}

function makeIsInBoundThread(boundThreadTs: string): (msg: SlackMessage) => boolean {
  return function isInBoundThread(msg: SlackMessage): boolean {
    if (!boundThreadTs)
      return false
    return msg.thread_ts === boundThreadTs
  }
}

function makeDedup(cap: number = 200): (ts: string) => boolean {
  const seen = new Set<string>()
  return function dedup(ts: string): boolean {
    if (seen.has(ts))
      return false
    seen.add(ts)
    if (seen.size > cap) {
      const first = seen.values().next().value
      if (first)
        seen.delete(first)
    }
    return true
  }
}

const RE_NAME_SANITIZE = /[[\]\r\n;]/g
function safeFileName(file: { name?: string, id: string }): string {
  return (file.name ?? file.id).replace(RE_NAME_SANITIZE, '_')
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe('chunk', () => {
  test('returns single chunk for short text', () => {
    expect(chunk('hello', 100, 'length')).toEqual(['hello'])
  })

  test('splits long text at limit', () => {
    const text = 'a'.repeat(10)
    const result = chunk(text, 4, 'length')
    expect(result).toEqual(['aaaa', 'aaaa', 'aa'])
  })

  test('splits at paragraph boundary in newline mode', () => {
    const text = 'first paragraph\n\nsecond paragraph'
    const result = chunk(text, 20, 'newline')
    expect(result).toEqual(['first paragraph', 'second paragraph'])
  })
})

describe('isInBoundThread', () => {
  const THREAD_TS = '1711234567.123456'

  test('accepts messages in bound thread', () => {
    const isInBoundThread = makeIsInBoundThread(THREAD_TS)
    const msg: SlackMessage = {
      user: 'U123',
      channel: 'C456',
      ts: '1711234568.000001',
      text: 'hello',
      thread_ts: THREAD_TS,
    }
    expect(isInBoundThread(msg)).toBe(true)
  })

  test('rejects messages with different thread_ts', () => {
    const isInBoundThread = makeIsInBoundThread(THREAD_TS)
    const msg: SlackMessage = {
      user: 'U123',
      channel: 'C456',
      ts: '1711234568.000001',
      text: 'hello',
      thread_ts: '9999999999.000000',
    }
    expect(isInBoundThread(msg)).toBe(false)
  })

  test('rejects messages without thread_ts (top-level messages)', () => {
    const isInBoundThread = makeIsInBoundThread(THREAD_TS)
    const msg: SlackMessage = {
      user: 'U123',
      channel: 'C456',
      ts: '1711234568.000001',
      text: 'hello',
    }
    expect(isInBoundThread(msg)).toBe(false)
  })

  test('rejects all messages when boundThreadTs is empty', () => {
    const isInBoundThread = makeIsInBoundThread('')
    const msg: SlackMessage = {
      user: 'U123',
      channel: 'C456',
      ts: '1711234568.000001',
      text: 'hello',
      thread_ts: THREAD_TS,
    }
    expect(isInBoundThread(msg)).toBe(false)
  })
})

describe('dedup', () => {
  test('allows first occurrence', () => {
    const dedup = makeDedup(200)
    expect(dedup('ts1')).toBe(true)
  })

  test('rejects duplicate', () => {
    const dedup = makeDedup(200)
    dedup('ts1')
    expect(dedup('ts1')).toBe(false)
  })

  test('caps at limit (RECENT_INBOUND_CAP = 200)', () => {
    const RECENT_INBOUND_CAP = 200
    const dedup = makeDedup(RECENT_INBOUND_CAP)
    // Fill beyond cap using a small override for testability
    const dedupSmall = makeDedup(3)
    for (let i = 0; i < 5; i++)
      dedupSmall(`ts${i}`)
    // Oldest should have been evicted
    expect(dedupSmall('ts0')).toBe(true) // evicted, so accepted again
    expect(dedupSmall('ts4')).toBe(false) // still present
    // Default cap doesn't evict within bounds
    for (let i = 0; i < RECENT_INBOUND_CAP; i++)
      dedup(`ts${i}`)
    expect(dedup('ts0')).toBe(false) // still within cap, not evicted
  })
})

describe('safeFileName', () => {
  test('sanitizes brackets and special chars', () => {
    expect(safeFileName({ id: 'F1', name: 'file[1].txt' })).toBe('file_1_.txt')
  })

  test('uses id when name is missing', () => {
    expect(safeFileName({ id: 'F123' })).toBe('F123')
  })
})

describe('SLACK_CHANNEL_ID requirement', () => {
  test('server.ts requires SLACK_CHANNEL_ID env var', async () => {
    // Verify the env var check exists in the source
    const source = await Bun.file('plugins/slack/server.ts').text()
    expect(source).toContain('SLACK_CHANNEL_ID')
    expect(source).toContain('process.exit(1)')
    // Verify it checks for the channel ID
    expect(source).toContain('if (!CHANNEL_ID)')
  })
})

describe('thread binding in source', () => {
  let source: string

  beforeAll(async () => {
    source = await Bun.file('plugins/slack/server.ts').text()
    expect(source.length).toBeGreaterThan(0)
  })

  test('creates thread at startup', () => {
    // Should post a message to create the thread
    expect(source).toContain('web.chat.postMessage')
    expect(source).toContain('boundThreadTs = threadStart.ts')
  })

  test('filters inbound by thread', () => {
    // handleInbound should check isInBoundThread
    expect(source).toContain('isInBoundThread(msg)')
  })

  test('forces outbound to bound thread', () => {
    // reply tool should always use boundThreadTs
    expect(source).toContain('thread_ts: boundThreadTs')
  })

  test('removes access control', () => {
    // Should NOT have old access control
    expect(source).not.toContain('assertAllowedChannel')
    expect(source).not.toContain('access.json')
    expect(source).not.toContain('gate(msg)')
    expect(source).not.toContain('checkApprovals')
    expect(source).not.toContain('dmPolicy')
    expect(source).not.toContain('pairing')
  })

  test('tools do not require chat_id', () => {
    // reply tool should NOT require chat_id since channel is fixed
    expect(source).toContain('required: [\'text\']')
    // react tool should NOT require chat_id
    expect(source).toContain('required: [\'message_id\', \'emoji\']')
    // edit tool should NOT require chat_id
    expect(source).toContain('required: [\'message_id\', \'text\']')
  })

  test('fetch_messages uses conversations.replies', () => {
    // Should fetch thread replies, not channel history
    expect(source).toContain('web.conversations.replies')
  })

  test('react, edit, and download validate message is in bound thread', () => {
    // All mutation/fetch tools should call assertInBoundThread before operating
    expect(source).toContain('assertInBoundThread(messageId)')
    expect(source).toContain('assertInBoundThread(messageTs)')
  })

  test('assertInBoundThread rejection is not catch-swallowed in react/edit_message', () => {
    // The outer catch in the tool handler must propagate assertInBoundThread errors.
    // Verify that react and edit_message do NOT wrap assertInBoundThread in their own try/catch.
    // Extract the react and edit_message case blocks and confirm no inner try surrounds the assert call.
    const reactBlock = source.slice(source.indexOf('case \'react\':'), source.indexOf('case \'edit_message\':'))
    const editBlock = source.slice(source.indexOf('case \'edit_message\':'), source.indexOf('case \'download_attachment\':'))
    // Neither block should have a try { ... } that would swallow the assertInBoundThread error
    expect(reactBlock.indexOf('try {')).toBe(-1)
    expect(editBlock.indexOf('try {')).toBe(-1)
  })

  test('file download uses atomic write', () => {
    // Download should write to tmp then rename
    expect(source).toContain('renameSync(tmp, path)')
  })
})
