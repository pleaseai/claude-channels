import type { Buffer } from 'node:buffer'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { GitHubClientLike, GitHubMessage } from './server'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { afterAll, describe, expect, it } from 'bun:test'

// Point the module's state dir at a temp dir BEFORE importing it, so the
// save*/load* helpers (which use the module-level STATE_DIR) stay sandboxed.
const STATE_DIR = mkdtempSync(join(tmpdir(), 'gh-channel-test-'))
process.env.CLAUDE_GITHUB_STATE_DIR = STATE_DIR
const mod = await import('./server')
const {
  parseRepos,
  parseChatId,
  formatChatId,
  issueNumberFromUrl,
  mentionsHandle,
  chunkText,
  isAllowed,
  isWatchedRepo,
  isValidReaction,
  buildChannelMeta,
  commentTypeFromUrl,
  resolvePollInterval,
  backoffDelay,
  resolveRateLimitThreshold,
  shouldPauseForRateLimit,
  retryAfterDelay,
  rateLimitPauseMs,
  checkRateLimitPause,
  nextBackoffDelay,
  resolveHandle,
  seedCursor,
  rememberPostedIds,
  Dedup,
  loadAccess,
  saveAccess,
  loadCursor,
  saveCursor,
  replyCore,
  reactCore,
  editCore,
  fetchCore,
  pollRepo,
  handleToolCall,
  loadDotEnv,
} = mod

afterAll(() => {
  rmSync(STATE_DIR, { recursive: true, force: true })
})

const WATCHED = [{ owner: 'acme', repo: 'app' }]

function mockClient(overrides: Partial<Record<string, unknown>> = {}): { client: GitHubClientLike, calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = { create: [], update: [], react: [], list: [], listRepo: [], rateLimit: [] }
  let nextId = 1000
  const client = {
    rest: {
      issues: {
        createComment: async (p: unknown) => {
          calls.create.push(p)
          return { data: { id: nextId++, html_url: 'https://gh/c' } }
        },
        updateComment: async (p: unknown) => {
          calls.update.push(p)
          return { data: { id: (p as { comment_id: number }).comment_id, html_url: 'https://gh/c' } }
        },
        listComments: async (p: unknown) => {
          calls.list.push(p)
          return { data: (overrides.listComments as unknown[]) ?? [] }
        },
        listCommentsForRepo: async (p: unknown) => {
          calls.listRepo.push(p)
          // Simulate Octokit throwing (e.g. 304 Not Modified, 429) when configured.
          if (overrides.listThrow)
            throw overrides.listThrow
          return {
            data: (overrides.listCommentsForRepo as unknown[]) ?? [],
            headers: { etag: overrides.etag as string | undefined },
          }
        },
      },
      reactions: {
        createForIssueComment: async (p: unknown) => {
          calls.react.push(p)
          return {}
        },
      },
      rateLimit: {
        get: async () => {
          calls.rateLimit.push({})
          if (overrides.rateLimitThrow)
            throw overrides.rateLimitThrow
          const core = (overrides.rateLimit as { remaining: number, reset: number } | undefined)
            ?? { remaining: 5000, reset: 0 }
          return { data: { resources: { core } } }
        },
      },
    },
  } as unknown as GitHubClientLike
  return { client, calls }
}

describe('parseRepos', () => {
  it('parses a comma-separated list', () => {
    expect(parseRepos('acme/app, foo/bar')).toEqual([
      { owner: 'acme', repo: 'app' },
      { owner: 'foo', repo: 'bar' },
    ])
  })
  it('returns [] for undefined/empty', () => {
    expect(parseRepos(undefined)).toEqual([])
    expect(parseRepos('  ')).toEqual([])
  })
  it('throws on malformed entries', () => {
    expect(() => parseRepos('acme')).toThrow()
    expect(() => parseRepos('acme/')).toThrow()
  })
})

describe('chat id round-trip', () => {
  it('formats and parses', () => {
    expect(formatChatId('acme', 'app', 12)).toBe('acme/app#12')
    expect(parseChatId('acme/app#12')).toEqual({ owner: 'acme', repo: 'app', issueNumber: 12 })
  })
  it('throws on invalid', () => {
    expect(() => parseChatId('acme/app')).toThrow()
    expect(() => parseChatId('nope')).toThrow()
  })
})

describe('issueNumberFromUrl', () => {
  it('reads issue and pull urls', () => {
    expect(issueNumberFromUrl('https://api.github.com/repos/acme/app/issues/42')).toBe(42)
    expect(issueNumberFromUrl('https://api.github.com/repos/acme/app/pulls/7')).toBe(7)
    expect(issueNumberFromUrl(undefined)).toBeUndefined()
  })
})

describe('commentTypeFromUrl', () => {
  it('classifies pulls urls as pr, everything else as issue', () => {
    expect(commentTypeFromUrl('https://api.github.com/repos/acme/app/pulls/7')).toBe('pr')
    expect(commentTypeFromUrl('https://api.github.com/repos/acme/app/issues/5')).toBe('issue')
    expect(commentTypeFromUrl(undefined)).toBe('issue')
  })
})

describe('mentionsHandle', () => {
  it('matches case-insensitively on a word boundary', () => {
    expect(mentionsHandle('hey @ClaudeBot help', 'claudebot')).toBe(true)
    expect(mentionsHandle('@claudebot', 'claudebot')).toBe(true)
  })
  it('does not match substrings or absent mentions', () => {
    expect(mentionsHandle('email claudebot@x.com', 'claudebot')).toBe(false)
    expect(mentionsHandle('@claudebotter', 'claudebot')).toBe(false)
    expect(mentionsHandle('no mention here', 'claudebot')).toBe(false)
    expect(mentionsHandle(undefined, 'claudebot')).toBe(false)
  })
})

describe('chunkText', () => {
  it('keeps short text in one chunk', () => {
    expect(chunkText('hello', 10)).toEqual(['hello'])
  })
  it('splits long text', () => {
    const parts = chunkText('a'.repeat(25), 10)
    expect(parts.length).toBe(3)
    expect(parts.join('')).toBe('a'.repeat(25))
  })
})

describe('access gating', () => {
  it('open mode allows everyone', () => {
    expect(isAllowed({ mode: 'open', allowedLogins: [], configured: true }, 'anyone')).toBe(true)
  })
  it('allowlist matches case-insensitively', () => {
    const a = { mode: 'allowlist' as const, allowedLogins: ['Alice'], configured: true }
    expect(isAllowed(a, 'alice')).toBe(true)
    expect(isAllowed(a, 'bob')).toBe(false)
  })
})

describe('outbound gating', () => {
  it('matches watched repos case-insensitively', () => {
    expect(isWatchedRepo(WATCHED, 'ACME', 'App')).toBe(true)
    expect(isWatchedRepo(WATCHED, 'acme', 'other')).toBe(false)
  })
})

describe('config + backoff helpers', () => {
  it('resolves poll interval from env with fallback', () => {
    expect(resolvePollInterval('3000', 5000)).toBe(3000)
    expect(resolvePollInterval(undefined, 5000)).toBe(5000)
    expect(resolvePollInterval('0', 5000)).toBe(5000)
    expect(resolvePollInterval('nope', 5000)).toBe(5000)
  })
  it('computes capped exponential backoff', () => {
    expect(backoffDelay(1000, 0)).toBe(1000)
    expect(backoffDelay(1000, 1)).toBe(2000)
    expect(backoffDelay(1000, 3)).toBe(8000)
    expect(backoffDelay(1000, 20)).toBe(12000) // capped at 12x
  })
  it('resolves the mention handle, defaulting to self', () => {
    expect(resolveHandle('botname', 'self')).toBe('botname')
    expect(resolveHandle('  ', 'self')).toBe('self')
    expect(resolveHandle(undefined, 'self')).toBe('self')
  })
  it('seeds cursors only for unseen repos', () => {
    const cursor: { repos: Record<string, { since?: string }> } = { repos: { 'acme/app': { since: 'old' } } }
    seedCursor(cursor, [{ owner: 'acme', repo: 'app' }, { owner: 'foo', repo: 'bar' }], 'now')
    expect(cursor.repos['acme/app'].since).toBe('old') // preserved
    expect(cursor.repos['foo/bar'].since).toBe('now') // seeded
  })
})

describe('rate-limit helpers', () => {
  it('resolves the threshold from env, allowing 0 and falling back', () => {
    expect(resolveRateLimitThreshold('100', 50)).toBe(100)
    expect(resolveRateLimitThreshold('0', 50)).toBe(0) // 0 = pause only at full exhaustion
    expect(resolveRateLimitThreshold(undefined, 50)).toBe(50)
    expect(resolveRateLimitThreshold('nope', 50)).toBe(50)
    expect(resolveRateLimitThreshold('-5', 50)).toBe(50)
  })
  it('pauses when remaining is at or below the threshold', () => {
    expect(shouldPauseForRateLimit(10, 50)).toBe(true)
    expect(shouldPauseForRateLimit(50, 50)).toBe(true) // boundary
    expect(shouldPauseForRateLimit(200, 50)).toBe(false)
  })
  it('reads Retry-After seconds into ms, undefined when absent or invalid', () => {
    expect(retryAfterDelay({ response: { headers: { 'retry-after': '30' } } })).toBe(30000)
    expect(retryAfterDelay({ response: { headers: {} } })).toBeUndefined()
    expect(retryAfterDelay(new Error('x'))).toBeUndefined()
    expect(retryAfterDelay({ response: { headers: { 'retry-after': 'soon' } } })).toBeUndefined()
  })
})

describe('proactive rate-limit pause', () => {
  it('does not pause when remaining is above the threshold', () => {
    expect(rateLimitPauseMs(200, 50, 2000, 1000)).toBe(0)
  })
  it('pauses until the reset instant when remaining is low', () => {
    // reset at epoch 2000s = 2_000_000ms; now = 1_000_000ms → pause 1_000_000ms
    expect(rateLimitPauseMs(10, 50, 2000, 1_000_000)).toBe(1_000_000)
  })
  it('clamps the pause to 0 when reset is already in the past', () => {
    expect(rateLimitPauseMs(10, 50, 1000, 2_000_000)).toBe(0)
  })
  it('checkRateLimitPause pauses when the client reports low remaining', async () => {
    const { client, calls } = mockClient({ rateLimit: { remaining: 5, reset: 1000 } })
    expect(await checkRateLimitPause(client, 50, 0)).toBe(1_000_000) // reset 1000s from epoch 0
    expect(calls.rateLimit.length).toBe(1)
  })
  it('checkRateLimitPause returns 0 when quota is healthy', async () => {
    const { client } = mockClient({ rateLimit: { remaining: 5000, reset: 1000 } })
    expect(await checkRateLimitPause(client, 50, 0)).toBe(0)
  })
  it('checkRateLimitPause fails open (0) when rate_limit errors', async () => {
    const { client } = mockClient({ rateLimitThrow: new Error('rate_limit down') })
    expect(await checkRateLimitPause(client, 50, 0)).toBe(0)
  })
})

describe('Retry-After backoff', () => {
  it('uses plain exponential backoff when no Retry-After is present', () => {
    expect(nextBackoffDelay(1000, 1)).toBe(2000)
  })
  it('honors Retry-After when it exceeds the exponential backoff', () => {
    expect(nextBackoffDelay(1000, 1, 30000)).toBe(30000)
  })
  it('keeps the larger of exponential backoff and Retry-After', () => {
    expect(nextBackoffDelay(1000, 5, 1000)).toBe(12000) // capped exp (12x) wins over 1s retry-after
  })
})

describe('reactions + dedup + meta', () => {
  it('validates reaction names', () => {
    expect(isValidReaction('rocket')).toBe(true)
    expect(isValidReaction('thumbsup')).toBe(false)
  })
  it('dedups by id with a cap', () => {
    const d = new Dedup(2)
    expect(d.check(1)).toBe(true)
    expect(d.check(1)).toBe(false)
    expect(d.check(2)).toBe(true)
    expect(d.check(3)).toBe(true) // evicts 1
    expect(d.check(1)).toBe(true) // 1 was evicted, seen as new again
  })
  it('builds identifier-only meta', () => {
    const meta = buildChannelMeta({
      repo: 'acme/app',
      issueNumber: 5,
      commentId: 99,
      user: 'alice',
      userId: 7,
      body: 'hi',
      htmlUrl: 'https://github.com/acme/app/issues/5#issuecomment-99',
      createdAt: '2026-05-29T00:00:00Z',
      commentType: 'issue',
    })
    expect(meta.chat_id).toBe('acme/app#5')
    expect(meta.message_id).toBe('99')
    expect(meta.user).toBe('alice')
    expect(meta.comment_type).toBe('issue')
  })
  it('remembers single and multi posted comment ids', () => {
    const own = new Set<number>()
    rememberPostedIds('commented (id: 42)', own)
    rememberPostedIds('commented in 2 parts (ids: 7, 8)', own)
    rememberPostedIds('nothing here', own)
    expect([...own].sort((a, b) => a - b)).toEqual([7, 8, 42])
  })
})

describe('state IO round-trip', () => {
  it('persists and reloads access', () => {
    saveAccess({ mode: 'allowlist', allowedLogins: ['alice'], configured: true })
    expect(loadAccess()).toEqual({ mode: 'allowlist', allowedLogins: ['alice'], configured: true })
  })
  it('falls back to default access when missing', () => {
    const fresh = mkdtempSync(join(tmpdir(), 'gh-empty-'))
    expect(loadAccess(fresh)).toEqual({ mode: 'allowlist', allowedLogins: [], configured: false })
    rmSync(fresh, { recursive: true, force: true })
  })
  it('persists and reloads cursor', () => {
    saveCursor({ repos: { 'acme/app': { since: '2026-05-29T00:00:00Z' } } })
    expect(loadCursor().repos['acme/app'].since).toBe('2026-05-29T00:00:00Z')
  })
  it('persists and reloads the etag alongside since', () => {
    saveCursor({ repos: { 'acme/app': { since: '2026-05-29T00:00:00Z', etag: 'W/"abc123"' } } })
    const loaded = loadCursor().repos['acme/app']
    expect(loaded.since).toBe('2026-05-29T00:00:00Z')
    expect(loaded.etag).toBe('W/"abc123"')
  })
  it('loads a legacy cursor without an etag', () => {
    saveCursor({ repos: { 'foo/bar': { since: '2026-05-29T00:00:00Z' } } })
    expect(loadCursor().repos['foo/bar'].etag).toBeUndefined()
  })
})

describe('replyCore', () => {
  it('posts a comment to a watched repo', async () => {
    const { client, calls } = mockClient()
    const out = await replyCore(client, WATCHED, { chat_id: 'acme/app#5', body: 'hi' })
    expect(out).toContain('commented')
    expect((calls.create[0] as { issue_number: number }).issue_number).toBe(5)
  })
  it('rejects un-watched repos', async () => {
    const { client } = mockClient()
    await expect(replyCore(client, WATCHED, { chat_id: 'other/repo#1', body: 'hi' })).rejects.toThrow(/un-watched/)
  })
  it('chunks bodies over the comment limit', async () => {
    const { client, calls } = mockClient()
    const out = await replyCore(client, WATCHED, { chat_id: 'acme/app#5', body: 'x'.repeat(70000) })
    expect(calls.create.length).toBe(2)
    expect(out).toContain('2 parts')
  })
})

describe('reactCore', () => {
  it('rejects invalid reactions', async () => {
    const { client } = mockClient()
    await expect(reactCore(client, WATCHED, { chat_id: 'acme/app#5', comment_id: 1, reaction: 'nope' })).rejects.toThrow(/invalid reaction/)
  })
  it('reacts on watched repos', async () => {
    const { client, calls } = mockClient()
    expect(await reactCore(client, WATCHED, { chat_id: 'acme/app#5', comment_id: 1, reaction: 'eyes' })).toBe('reacted')
    expect((calls.react[0] as { content: string }).content).toBe('eyes')
  })
  it('rejects un-watched repos', async () => {
    const { client } = mockClient()
    await expect(reactCore(client, WATCHED, { chat_id: 'other/repo#1', comment_id: 1, reaction: 'eyes' })).rejects.toThrow(/un-watched/)
  })
})

describe('editCore', () => {
  it('refuses to edit comments not posted this session', async () => {
    const { client } = mockClient()
    await expect(editCore(client, WATCHED, new Set(), { chat_id: 'acme/app#5', comment_id: 9, body: 'x' })).rejects.toThrow(/not posted/)
  })
  it('edits own comments', async () => {
    const { client } = mockClient()
    const out = await editCore(client, WATCHED, new Set([9]), { chat_id: 'acme/app#5', comment_id: 9, body: 'x' })
    expect(out).toContain('edited')
  })
  it('rejects un-watched repos before checking ownership', async () => {
    const { client } = mockClient()
    await expect(editCore(client, WATCHED, new Set([9]), { chat_id: 'other/repo#9', comment_id: 9, body: 'x' })).rejects.toThrow(/un-watched/)
  })
})

describe('fetchCore', () => {
  it('lists comments with self attribution', async () => {
    const { client } = mockClient({
      listComments: [
        { id: 1, body: 'hello', user: { login: 'alice' }, created_at: 't' },
        { id: 2, body: 'world', user: { login: 'mybot' }, created_at: 't' },
      ],
    })
    const out = await fetchCore(client, WATCHED, 'mybot', { chat_id: 'acme/app#5' })
    expect(out).toContain('alice: hello')
    expect(out).toContain('me: world')
  })
  it('reports empty threads', async () => {
    const { client } = mockClient({ listComments: [] })
    expect(await fetchCore(client, WATCHED, 'mybot', { chat_id: 'acme/app#5' })).toBe('(no messages)')
  })
  it('rejects un-watched repos', async () => {
    const { client } = mockClient()
    await expect(fetchCore(client, WATCHED, 'mybot', { chat_id: 'other/repo#1' })).rejects.toThrow(/un-watched/)
  })
})

describe('pollRepo', () => {
  const comments = [
    { id: 1, body: '@mybot help', html_url: 'h1', created_at: 't', user: { login: 'alice', id: 1 }, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
    { id: 2, body: '@mybot self', html_url: 'h2', created_at: 't', user: { login: 'mybot', id: 2 }, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
    { id: 3, body: '@mybot hi', html_url: 'h3', created_at: 't', user: { login: 'bob', id: 3 }, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
    { id: 4, body: 'no mention', html_url: 'h4', created_at: 't', user: { login: 'alice', id: 1 }, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
    { id: 5, body: '@mybot pr', html_url: 'h5', created_at: 't', user: { login: 'alice', id: 1 }, issue_url: 'https://api.github.com/repos/acme/app/pulls/7' },
  ]

  it('emits only mentioning, non-self, allowed comments and dedups', async () => {
    const { client } = mockClient({ listCommentsForRepo: comments })
    const access = { mode: 'allowlist' as const, allowedLogins: ['alice'], configured: true }
    const dedup = new Dedup()
    const got: GitHubMessage[] = []
    const cursor = await pollRepo(client, { owner: 'acme', repo: 'app' }, {}, { handle: 'mybot', selfLogin: 'mybot', dedup, access }, m => got.push(m))
    expect(got.map(m => m.commentId)).toEqual([1, 5])
    expect(got[0].commentType).toBe('issue')
    expect(got[1].commentType).toBe('pr')
    expect(got[1].issueNumber).toBe(7)
    expect(cursor.since).toBeTruthy()

    // Second poll over the same data emits nothing (deduped).
    const got2: GitHubMessage[] = []
    await pollRepo(client, { owner: 'acme', repo: 'app' }, cursor, { handle: 'mybot', selfLogin: 'mybot', dedup, access }, m => got2.push(m))
    expect(got2).toEqual([])
  })

  it('skips comments with no author and self-authored comments', async () => {
    const data = [
      { id: 10, body: '@mybot hi', html_url: 'h', created_at: 't', user: null, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
      { id: 11, body: '@mybot hi', html_url: 'h', created_at: 't', user: { login: 'mybot', id: 2 }, issue_url: 'https://api.github.com/repos/acme/app/issues/5' },
    ]
    const { client } = mockClient({ listCommentsForRepo: data })
    const got: GitHubMessage[] = []
    await pollRepo(
      client,
      { owner: 'acme', repo: 'app' },
      {},
      { handle: 'mybot', selfLogin: 'mybot', dedup: new Dedup(), access: { mode: 'open', allowedLogins: [], configured: true } },
      m => got.push(m),
    )
    expect(got).toEqual([]) // null-author skipped, self-authored skipped
  })

  const condCtx = {
    handle: 'mybot',
    selfLogin: 'mybot',
    dedup: new Dedup(),
    access: { mode: 'open' as const, allowedLogins: [], configured: true },
  }
  const ref = { owner: 'acme', repo: 'app' }

  it('sends If-None-Match from the cursor and stores the response etag', async () => {
    const { client, calls } = mockClient({ listCommentsForRepo: [], etag: 'W/"new"' })
    const cursor = await pollRepo(client, ref, { since: 's', etag: 'W/"old"' }, { ...condCtx, dedup: new Dedup() }, () => {})
    expect((calls.listRepo[0] as { headers?: { 'if-none-match'?: string } }).headers?.['if-none-match']).toBe('W/"old"')
    expect(cursor.etag).toBe('W/"new"')
    expect(cursor.since).toBeTruthy()
  })

  it('omits If-None-Match on the first poll (no stored etag)', async () => {
    const { client, calls } = mockClient({ listCommentsForRepo: [], etag: 'W/"first"' })
    const cursor = await pollRepo(client, ref, {}, { ...condCtx, dedup: new Dedup() }, () => {})
    expect((calls.listRepo[0] as { headers?: unknown }).headers).toBeUndefined()
    expect(cursor.etag).toBe('W/"first"')
  })

  it('treats a 304 as no new items: keeps etag, advances since, emits nothing', async () => {
    const { client } = mockClient({ listThrow: Object.assign(new Error('Not Modified'), { status: 304 }) })
    const got: GitHubMessage[] = []
    const cursor = await pollRepo(client, ref, { since: 'old', etag: 'W/"keep"' }, { ...condCtx, dedup: new Dedup() }, m => got.push(m))
    expect(got).toEqual([])
    expect(cursor.etag).toBe('W/"keep"')
    expect(cursor.since).toBeTruthy()
    expect(cursor.since).not.toBe('old') // timestamp advanced
  })

  it('propagates non-304 errors to the caller', async () => {
    const { client } = mockClient({ listThrow: Object.assign(new Error('boom'), { status: 500 }) })
    await expect(
      pollRepo(client, ref, { since: 's' }, { ...condCtx, dedup: new Dedup() }, () => {}),
    ).rejects.toThrow('boom')
  })
})

describe('handleToolCall', () => {
  const deps = () => ({ client: mockClient().client, repos: WATCHED, ownComments: new Set<number>(), selfLogin: 'mybot' })

  it('dispatches reply and tracks posted ids', async () => {
    const d = deps()
    const res = await handleToolCall('reply', { chat_id: 'acme/app#5', body: 'hi' }, d)
    expect(res.isError).toBeUndefined()
    expect(res.text).toContain('commented')
    expect(d.ownComments.size).toBe(1)
  })
  it('returns isError for an unknown tool', async () => {
    const res = await handleToolCall('nope', {}, deps())
    expect(res.isError).toBe(true)
    expect(res.text).toContain('unknown tool')
  })
  it('wraps core errors as isError', async () => {
    const res = await handleToolCall('react', { chat_id: 'acme/app#5', comment_id: 1, reaction: 'bad' }, deps())
    expect(res.isError).toBe(true)
    expect(res.text).toContain('react failed')
  })
  it('dispatches fetch_messages', async () => {
    const res = await handleToolCall('fetch_messages', { chat_id: 'acme/app#5' }, deps())
    expect(res.text).toBe('(no messages)')
  })
})

describe('loadDotEnv', () => {
  it('loads .env values into process.env without overriding existing', () => {
    writeFileSync(join(STATE_DIR, '.env'), 'GH_TEST_LOADENV=fromfile\n')
    delete process.env.GH_TEST_LOADENV
    loadDotEnv()
    expect(String(process.env.GH_TEST_LOADENV)).toBe('fromfile')
  })
})

/* ------------------------------------------------------------------ */
/*  Integration: spawn server.ts over MCP stdio                        */
/* ------------------------------------------------------------------ */

const SERVER_PATH = join(import.meta.dir, 'server.ts')

interface JsonRpcResponse {
  jsonrpc: string
  id?: number
  result?: unknown
  error?: { code: number, message: string }
}

class McpTestClient {
  private proc: ChildProcessWithoutNullStreams
  private buffer = ''
  private pending = new Map<number, (res: JsonRpcResponse) => void>()
  private nextId = 1

  constructor(env: Record<string, string>) {
    this.proc = spawn('bun', [SERVER_PATH], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    this.proc.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString()
    let idx = this.buffer.indexOf('\n')
    while (idx >= 0) {
      const line = this.buffer.slice(0, idx)
      this.buffer = this.buffer.slice(idx + 1)
      if (line.trim()) {
        try {
          const msg = JSON.parse(line) as JsonRpcResponse
          if (msg.id !== undefined && this.pending.has(msg.id)) {
            this.pending.get(msg.id)!(msg)
            this.pending.delete(msg.id)
          }
        }
        catch {
          // ignore non-JSON lines
        }
      }
      idx = this.buffer.indexOf('\n')
    }
  }

  async send(method: string, params?: unknown): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const req = { jsonrpc: '2.0', id, method, params }
    return new Promise((resolve) => {
      this.pending.set(id, resolve)
      this.proc.stdin.write(`${JSON.stringify(req)}\n`)
    })
  }

  kill(): void {
    this.proc.kill()
  }
}

describe('github channel server (mcp stdio)', () => {
  it('responds to initialize and lists tools', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'gh-channel-itest-'))
    const client = new McpTestClient({
      CLAUDE_GITHUB_TOKEN: 'github_pat_test',
      CLAUDE_GITHUB_REPOS: 'acme/app',
      CLAUDE_GITHUB_STATE_DIR: stateDir,
      CLAUDE_GITHUB_POLL_INTERVAL_MS: '60000',
    })
    try {
      const initRes = await client.send('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' },
      })
      expect(initRes.result).toBeDefined()

      const toolsRes = await client.send('tools/list', {})
      const result = toolsRes.result as { tools: { name: string }[] }
      const names = result.tools.map(t => t.name)
      expect(names).toContain('reply')
      expect(names).toContain('react')
      expect(names).toContain('edit_message')
      expect(names).toContain('fetch_messages')
    }
    finally {
      client.kill()
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
