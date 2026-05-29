import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { GitHubClientLike, GitHubMessage } from './server'
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { createHmac, generateKeyPairSync } from 'node:crypto'
import { EventEmitter } from 'node:events'
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
  resolveTransport,
  loadAppConfig,
  createAppClient,
  verifyWebhookSignature,
  messageFromIssueCommentEvent,
  processIssueCommentEvent,
  handleWebhookRequest,
  startWebhookServer,
  WEBHOOK_PATH,
  parseTunnelUrl,
  cloudflaredArgs,
  startTunnel,
  webhookDeliveryUrl,
  registerWebhookUrl,
  startWebhookTransport,
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

describe('resolveTransport', () => {
  it('selects webhook only for the literal value (case-insensitive)', () => {
    expect(resolveTransport('webhook')).toBe('webhook')
    expect(resolveTransport('WebHook')).toBe('webhook')
    expect(resolveTransport('  webhook  ')).toBe('webhook')
  })
  it('defaults to poll when unset', () => {
    expect(resolveTransport(undefined)).toBe('poll')
    expect(resolveTransport('')).toBe('poll')
    expect(resolveTransport('poll')).toBe('poll')
  })
  it('falls back to poll for unrecognized values', () => {
    expect(resolveTransport('socket')).toBe('poll')
    expect(resolveTransport('webhooks')).toBe('poll')
  })
})

describe('loadAppConfig', () => {
  const full = {
    CLAUDE_GITHUB_APP_ID: '123',
    CLAUDE_GITHUB_APP_PRIVATE_KEY: '-----BEGIN KEY-----\nabc\n-----END KEY-----',
    CLAUDE_GITHUB_APP_INSTALLATION_ID: '456',
    CLAUDE_GITHUB_WEBHOOK_SECRET: 's3cr3t',
  }
  it('parses a complete credential set', () => {
    const cfg = loadAppConfig(full)
    expect(cfg.appId).toBe('123')
    expect(cfg.installationId).toBe(456)
    expect(cfg.webhookSecret).toBe('s3cr3t')
  })
  it('unescapes a single-line PEM with literal \\n escapes', () => {
    const cfg = loadAppConfig({ ...full, CLAUDE_GITHUB_APP_PRIVATE_KEY: 'line1\\nline2\\nline3' })
    expect(cfg.privateKey).toBe('line1\nline2\nline3')
  })
  it('preserves an already-multiline PEM verbatim', () => {
    const cfg = loadAppConfig(full)
    expect(cfg.privateKey).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----')
  })
  it('lists every missing key in the error', () => {
    expect(() => loadAppConfig({})).toThrow(/CLAUDE_GITHUB_APP_ID.*CLAUDE_GITHUB_APP_PRIVATE_KEY.*CLAUDE_GITHUB_APP_INSTALLATION_ID.*CLAUDE_GITHUB_WEBHOOK_SECRET/)
  })
  it('rejects a non-numeric or non-positive installation id', () => {
    expect(() => loadAppConfig({ ...full, CLAUDE_GITHUB_APP_INSTALLATION_ID: 'abc' })).toThrow(/installation/i)
    expect(() => loadAppConfig({ ...full, CLAUDE_GITHUB_APP_INSTALLATION_ID: '0' })).toThrow(/positive integer/)
  })
})

describe('createAppClient', () => {
  // A real RSA key so @octokit/auth-app construction is exercised; no network
  // call is made until a request is issued, so this stays a pure unit test.
  const { privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  const cfg = { appId: '123', privateKey, installationId: 456, webhookSecret: 's' }

  it('builds a client satisfying GitHubClientLike (outbound tool surface)', () => {
    const client = createAppClient(cfg)
    expect(typeof client.rest.issues.createComment).toBe('function')
    expect(typeof client.rest.issues.updateComment).toBe('function')
    expect(typeof client.rest.issues.listComments).toBe('function')
    expect(typeof client.rest.issues.listCommentsForRepo).toBe('function')
    expect(typeof client.rest.reactions.createForIssueComment).toBe('function')
  })
  it('does not throw at construction for a well-formed config', () => {
    expect(() => createAppClient(cfg)).not.toThrow()
  })
})

describe('verifyWebhookSignature', () => {
  const secret = 'topsecret'
  const sign = (body: string): string => `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts a signature computed from the same secret + body', () => {
    const body = '{"action":"created"}'
    expect(verifyWebhookSignature(secret, sign(body), body)).toBe(true)
  })
  it('verifies raw bytes, including unicode and newlines', () => {
    const body = '{"body":"héllo\nwörld 🚀"}'
    expect(verifyWebhookSignature(secret, sign(body), Buffer.from(body))).toBe(true)
  })
  it('rejects a wrong secret', () => {
    const body = '{"action":"created"}'
    const forged = `sha256=${createHmac('sha256', 'other').update(body).digest('hex')}`
    expect(verifyWebhookSignature(secret, forged, body)).toBe(false)
  })
  it('rejects a tampered body', () => {
    expect(verifyWebhookSignature(secret, sign('{"a":1}'), '{"a":2}')).toBe(false)
  })
  it('rejects missing / malformed / wrong-length headers without throwing', () => {
    const body = 'x'
    expect(verifyWebhookSignature(secret, undefined, body)).toBe(false)
    expect(verifyWebhookSignature(secret, null, body)).toBe(false)
    expect(verifyWebhookSignature(secret, '', body)).toBe(false)
    expect(verifyWebhookSignature(secret, 'sha1=deadbeef', body)).toBe(false)
    expect(verifyWebhookSignature(secret, 'sha256=tooshort', body)).toBe(false)
    expect(verifyWebhookSignature('', sign(body), body)).toBe(false) // no secret
  })
})

describe('messageFromIssueCommentEvent', () => {
  const base = {
    action: 'created',
    comment: { id: 99, body: 'hi @bot', html_url: 'https://gh/c/99', created_at: '2026-05-30T00:00:00Z', user: { login: 'alice', id: 7 } },
    issue: { number: 42 },
    repository: { full_name: 'acme/app' },
  }
  it('maps a created issue comment', () => {
    const msg = messageFromIssueCommentEvent(base)
    expect(msg).toEqual({
      repo: 'acme/app',
      issueNumber: 42,
      commentId: 99,
      user: 'alice',
      userId: 7,
      body: 'hi @bot',
      htmlUrl: 'https://gh/c/99',
      createdAt: '2026-05-30T00:00:00Z',
      commentType: 'issue',
    })
  })
  it('marks a PR-conversation comment as commentType pr', () => {
    const msg = messageFromIssueCommentEvent({ ...base, issue: { number: 42, pull_request: { url: 'https://gh/pulls/42' } } })
    expect(msg?.commentType).toBe('pr')
  })
  it('defaults userId to 0 when absent (parity with poll)', () => {
    const msg = messageFromIssueCommentEvent({ ...base, comment: { ...base.comment, user: { login: 'alice' } } })
    expect(msg?.userId).toBe(0)
  })
  it('returns null for non-created actions', () => {
    expect(messageFromIssueCommentEvent({ ...base, action: 'edited' })).toBeNull()
    expect(messageFromIssueCommentEvent({ ...base, action: 'deleted' })).toBeNull()
  })
  it('returns null when required fields are missing', () => {
    expect(messageFromIssueCommentEvent({ action: 'created' })).toBeNull()
    expect(messageFromIssueCommentEvent({ ...base, comment: { ...base.comment, user: null } })).toBeNull()
    expect(messageFromIssueCommentEvent({ ...base, repository: null })).toBeNull()
    expect(messageFromIssueCommentEvent({ ...base, issue: null })).toBeNull()
  })
})

describe('webhook receiver', () => {
  const SECRET = 'whsecret'
  const OPEN_ACCESS = { mode: 'open' as const, allowedLogins: [], configured: true }

  function makeCtx(overrides: Partial<Record<string, unknown>> = {}): { ctx: any, emitted: GitHubMessage[] } {
    const emitted: GitHubMessage[] = []
    const ctx = {
      secret: SECRET,
      watched: WATCHED,
      handle: 'bot',
      selfLogin: 'mybot',
      dedup: new Dedup(),
      loadAccess: () => OPEN_ACCESS,
      emit: (m: GitHubMessage) => emitted.push(m),
      ...overrides,
    }
    return { ctx, emitted }
  }

  const commentEvent = (over: Record<string, unknown> = {}): string => JSON.stringify({
    action: 'created',
    comment: { id: 555, body: 'please @bot help', html_url: 'https://gh/c/555', created_at: '2026-05-30T01:00:00Z', user: { login: 'alice', id: 3 } },
    issue: { number: 42 },
    repository: { full_name: 'acme/app' },
    ...over,
  })

  function signedRequest(body: string, opts: { event?: string, sign?: boolean, method?: string, path?: string } = {}): Request {
    const { event = 'issue_comment', sign = true, method = 'POST', path = WEBHOOK_PATH } = opts
    const headers: Record<string, string> = { 'x-github-event': event }
    if (sign)
      headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`
    return new Request(`http://localhost${path}`, { method, headers, body: method === 'GET' ? undefined : body })
  }

  it('emits a mentioning, allowlisted, non-self comment and returns 200', async () => {
    const { ctx, emitted } = makeCtx()
    const res = await handleWebhookRequest(signedRequest(commentEvent()), ctx)
    expect(res.status).toBe(200)
    expect(emitted).toHaveLength(1)
    expect(emitted[0].commentId).toBe(555)
    expect(emitted[0].user).toBe('alice')
  })

  it('produces the same channel meta a polled comment would (AC-6)', async () => {
    const { ctx, emitted } = makeCtx()
    await handleWebhookRequest(signedRequest(commentEvent()), ctx)
    const meta = buildChannelMeta(emitted[0])
    expect(meta).toMatchObject({
      chat_id: 'acme/app#42',
      message_id: '555',
      user: 'alice',
      repo: 'acme/app',
      issue_number: '42',
      comment_type: 'issue',
    })
  })

  it('dedupes redelivery of the same comment id', async () => {
    const { ctx, emitted } = makeCtx()
    await handleWebhookRequest(signedRequest(commentEvent()), ctx)
    await handleWebhookRequest(signedRequest(commentEvent()), ctx)
    expect(emitted).toHaveLength(1)
  })

  it('ignores (200, no emit) comments without the mention, from self, unwatched repo, or non-allowlisted sender', async () => {
    const noMention = makeCtx()
    expect((await handleWebhookRequest(signedRequest(commentEvent({ comment: { id: 1, body: 'no ping', html_url: 'h', created_at: 't', user: { login: 'alice', id: 1 } } })), noMention.ctx)).status).toBe(200)
    expect(noMention.emitted).toHaveLength(0)

    const fromSelf = makeCtx()
    await handleWebhookRequest(signedRequest(commentEvent({ comment: { id: 2, body: '@bot hi', html_url: 'h', created_at: 't', user: { login: 'mybot', id: 9 } } })), fromSelf.ctx)
    expect(fromSelf.emitted).toHaveLength(0)

    const unwatched = makeCtx()
    await handleWebhookRequest(signedRequest(commentEvent({ repository: { full_name: 'other/repo' } })), unwatched.ctx)
    expect(unwatched.emitted).toHaveLength(0)

    const denied = makeCtx({ loadAccess: () => ({ mode: 'allowlist' as const, allowedLogins: ['bob'], configured: true }) })
    await handleWebhookRequest(signedRequest(commentEvent()), denied.ctx)
    expect(denied.emitted).toHaveLength(0)
  })

  it('acknowledges non-issue_comment events (e.g. ping) with 200 and no emit', async () => {
    const { ctx, emitted } = makeCtx()
    const res = await handleWebhookRequest(signedRequest(JSON.stringify({ zen: 'hi' }), { event: 'ping' }), ctx)
    expect(res.status).toBe(200)
    expect(emitted).toHaveLength(0)
  })

  it('rejects a forged/unsigned payload with 401 and never emits', async () => {
    const { ctx, emitted } = makeCtx()
    const unsigned = await handleWebhookRequest(signedRequest(commentEvent(), { sign: false }), ctx)
    expect(unsigned.status).toBe(401)
    const body = commentEvent()
    const forged = new Request(`http://localhost${WEBHOOK_PATH}`, { method: 'POST', headers: { 'x-github-event': 'issue_comment', 'x-hub-signature-256': 'sha256=deadbeef' }, body })
    expect((await handleWebhookRequest(forged, ctx)).status).toBe(401)
    expect(emitted).toHaveLength(0)
  })

  it('returns 404 for a wrong path and 405 for a wrong method', async () => {
    const { ctx } = makeCtx()
    expect((await handleWebhookRequest(signedRequest(commentEvent(), { path: '/nope' }), ctx)).status).toBe(404)
    expect((await handleWebhookRequest(signedRequest(commentEvent(), { method: 'GET' }), ctx)).status).toBe(405)
  })

  it('returns 400 for a correctly-signed issue_comment with invalid JSON', async () => {
    const { ctx } = makeCtx()
    const res = await handleWebhookRequest(signedRequest('{not json'), ctx)
    expect(res.status).toBe(400)
  })

  it('rejects an oversized payload with 413 before verifying or emitting', async () => {
    const { ctx, emitted } = makeCtx({ maxBodyBytes: 16 })
    const body = commentEvent() // well over 16 bytes
    const res = await handleWebhookRequest(signedRequest(body), ctx)
    expect(res.status).toBe(413)
    expect(emitted).toHaveLength(0)
  })

  it('rejects on a spoofed oversized Content-Length without buffering', async () => {
    const { ctx } = makeCtx({ maxBodyBytes: 16 })
    const req = new Request(`http://localhost${WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'x-github-event': 'issue_comment', 'content-length': '999999999' },
      body: 'tiny',
    })
    expect((await handleWebhookRequest(req, ctx)).status).toBe(413)
  })

  it('processIssueCommentEvent returns the emitted message or null', () => {
    const { ctx } = makeCtx()
    const msg = processIssueCommentEvent(JSON.parse(commentEvent()), ctx)
    expect(msg?.commentId).toBe(555)
    expect(processIssueCommentEvent({ action: 'edited' }, ctx)).toBeNull()
  })

  it('startWebhookServer binds an ephemeral port and stops cleanly', () => {
    const { ctx } = makeCtx()
    const handle = startWebhookServer(ctx, 0)
    expect(handle.port).toBeGreaterThan(0)
    expect(() => handle.stop()).not.toThrow()
  })
})

describe('parseTunnelUrl', () => {
  it('extracts a trycloudflare URL from a log line', () => {
    expect(parseTunnelUrl('2026-05-30 INF |  https://red-sky-1234.trycloudflare.com  |')).toBe('https://red-sky-1234.trycloudflare.com')
  })
  it('finds the URL mid-line among other text', () => {
    expect(parseTunnelUrl('Your quick Tunnel: https://abc-def.trycloudflare.com (expires soon)')).toBe('https://abc-def.trycloudflare.com')
  })
  it('returns null when no URL is present', () => {
    expect(parseTunnelUrl('INF Starting tunnel')).toBeNull()
    expect(parseTunnelUrl('https://example.com/not-cloudflare')).toBeNull()
  })
})

describe('cloudflaredArgs', () => {
  it('builds quick-tunnel args', () => {
    expect(cloudflaredArgs({ mode: 'quick', localPort: 8123 })).toEqual(['tunnel', '--url', 'http://localhost:8123'])
  })
  it('builds named-tunnel args with run <name>', () => {
    expect(cloudflaredArgs({ mode: 'named', localPort: 8123, name: 'mytun', hostname: 'gh.example.com' }))
      .toEqual(['tunnel', '--url', 'http://localhost:8123', 'run', 'mytun'])
  })
})

describe('startTunnel', () => {
  function fakeChild(): any {
    const child: any = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.kill = () => {
      child.killed = true
      return true
    }
    return child
  }

  it('resolves with the parsed URL for a quick tunnel', async () => {
    const child = fakeChild()
    const p = startTunnel({ mode: 'quick', localPort: 9001 }, { spawn: () => child })
    child.stderr.emit('data', Buffer.from('INF |  https://wind-tree-77.trycloudflare.com  |\n'))
    const handle = await p
    expect(handle.url).toBe('https://wind-tree-77.trycloudflare.com')
    handle.stop()
    expect(child.killed).toBe(true)
  })

  it('resolves with the configured hostname when a named tunnel registers', async () => {
    const child = fakeChild()
    const p = startTunnel({ mode: 'named', localPort: 9001, name: 't', hostname: 'gh.example.com' }, { spawn: () => child })
    child.stderr.emit('data', Buffer.from('INF Registered tunnel connection connIndex=0\n'))
    const handle = await p
    expect(handle.url).toBe('https://gh.example.com')
  })

  it('rejects when the named config is incomplete', async () => {
    await expect(startTunnel({ mode: 'named', localPort: 9001 })).rejects.toThrow(/named tunnel requires/)
  })

  it('rejects if cloudflared exits before becoming ready', async () => {
    const child = fakeChild()
    const p = startTunnel({ mode: 'quick', localPort: 9001 }, { spawn: () => child })
    child.emit('exit', 1)
    await expect(p).rejects.toThrow(/exited before the tunnel was ready/)
  })

  it('rejects on a readiness timeout', async () => {
    const child = fakeChild()
    const p = startTunnel({ mode: 'quick', localPort: 9001 }, { spawn: () => child, readyTimeoutMs: 15 })
    await expect(p).rejects.toThrow(/did not become ready/)
    expect(child.killed).toBe(true)
  })

  it('invokes onTunnelDown if cloudflared exits AFTER becoming ready', async () => {
    const child = fakeChild()
    let downCode: number | null | undefined
    const p = startTunnel({ mode: 'quick', localPort: 9001 }, {
      spawn: () => child,
      onTunnelDown: (code) => { downCode = code },
    })
    child.stderr.emit('data', Buffer.from('https://up-tunnel.trycloudflare.com\n'))
    await p
    child.emit('exit', 137)
    expect(downCode).toBe(137)
  })

  it('does NOT invoke onTunnelDown when the tunnel is stopped intentionally', async () => {
    const child = fakeChild()
    let called = false
    const p = startTunnel({ mode: 'quick', localPort: 9001 }, {
      spawn: () => child,
      onTunnelDown: () => { called = true },
    })
    child.stderr.emit('data', Buffer.from('https://up-tunnel.trycloudflare.com\n'))
    const handle = await p
    handle.stop()
    child.emit('exit', 0)
    expect(called).toBe(false)
  })
})

describe('webhookDeliveryUrl', () => {
  it('joins base + path, trimming trailing slashes', () => {
    expect(webhookDeliveryUrl('https://x.trycloudflare.com')).toBe('https://x.trycloudflare.com/webhook')
    expect(webhookDeliveryUrl('https://x.trycloudflare.com/')).toBe('https://x.trycloudflare.com/webhook')
    expect(webhookDeliveryUrl('https://gh.example.com', '/gh')).toBe('https://gh.example.com/gh')
  })
})

describe('registerWebhookUrl', () => {
  function appClient(impl?: (p: unknown) => Promise<unknown>): { client: any, calls: unknown[] } {
    const calls: unknown[] = []
    const client = {
      rest: { apps: { updateWebhookConfigForApp: async (p: unknown) => {
        calls.push(p)
        return impl ? impl(p) : {}
      } } },
    }
    return { client, calls }
  }

  it('updates the App webhook config with the delivery URL + secret', async () => {
    const { client, calls } = appClient()
    const url = await registerWebhookUrl(client, 'https://x.trycloudflare.com', 's3cr3t')
    expect(url).toBe('https://x.trycloudflare.com/webhook')
    expect(calls[0]).toEqual({ url: 'https://x.trycloudflare.com/webhook', secret: 's3cr3t', content_type: 'json' })
  })

  it('is idempotent across repeated registrations', async () => {
    const { client, calls } = appClient()
    await registerWebhookUrl(client, 'https://x.trycloudflare.com', 's')
    await registerWebhookUrl(client, 'https://x.trycloudflare.com', 's')
    expect(calls).toHaveLength(2)
  })

  it('wraps API failures in a clear error without leaking the secret', async () => {
    const { client } = appClient(() => Promise.reject(new Error('403 Forbidden')))
    const err = await registerWebhookUrl(client, 'https://x.trycloudflare.com', 'supersecret').catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toMatch(/failed to register webhook URL/)
    expect((err as Error).message).not.toContain('supersecret')
  })
})

describe('startWebhookTransport', () => {
  function wiring(): any {
    return {
      appCfg: { appId: '1', privateKey: 'k', installationId: 2, webhookSecret: 'sec' },
      appClient: {},
      repos: WATCHED,
      handle: 'bot',
      selfLogin: 'bot[bot]',
      dedup: new Dedup(),
      loadAccess: () => ({ mode: 'open' as const, allowedLogins: [], configured: true }),
      emit: () => {},
      port: 8765,
      tunnel: { mode: 'quick' as const, localPort: 8765 },
    }
  }

  function trackedServer(onStop: () => void): () => { port: number, stop: () => void } {
    return () => ({
      port: 8765,
      stop: onStop,
    })
  }

  it('binds the receiver, brings up the tunnel, then registers — in that order', async () => {
    const order: string[] = []
    const runtime = await startWebhookTransport(wiring(), {
      startServer: () => {
        order.push('server')
        return { port: 8765, stop: () => {} }
      },
      startTunnel: async () => {
        order.push('tunnel')
        return { url: 'https://x.trycloudflare.com', stop: () => {} }
      },
      registerWebhookUrl: async (_c, base) => {
        order.push('register')
        return `${base}/webhook`
      },
    })
    expect(order).toEqual(['server', 'tunnel', 'register'])
    expect(runtime.deliveryUrl).toBe('https://x.trycloudflare.com/webhook')
  })

  it('stops the local server and rethrows if the tunnel fails to start', async () => {
    let stopped = false
    const promise = startWebhookTransport(wiring(), {
      startServer: trackedServer(() => { stopped = true }),
      startTunnel: async () => { throw new Error('cloudflared missing') },
      registerWebhookUrl: async (_c, base) => `${base}/webhook`,
    })
    await expect(promise).rejects.toThrow(/cloudflared missing/)
    expect(stopped).toBe(true)
  })

  it('stops the local server if registration fails', async () => {
    let stopped = false
    const promise = startWebhookTransport(wiring(), {
      startServer: trackedServer(() => { stopped = true }),
      startTunnel: async () => ({ url: 'https://x.trycloudflare.com', stop: () => {} }),
      registerWebhookUrl: async () => { throw new Error('403') },
    })
    await expect(promise).rejects.toThrow(/403/)
    expect(stopped).toBe(true)
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

  it('delivers the same comment set across a 200 → 304 → 200 sequence (SC-5)', async () => {
    const mk = (id: number, login: string) => ({
      id,
      body: '@mybot hi',
      html_url: `h${id}`,
      created_at: 't',
      user: { login, id },
      issue_url: 'https://api.github.com/repos/acme/app/issues/5',
    })
    const ctx = { ...condCtx, dedup: new Dedup() }
    const got: number[] = []
    const emit = (m: GitHubMessage): void => void got.push(m.commentId)

    // Poll 1 — 200 with one comment, etag E1.
    const { client: c1 } = mockClient({ listCommentsForRepo: [mk(1, 'alice')], etag: 'E1' })
    let cursor = await pollRepo(c1, ref, {}, ctx, emit)
    expect(cursor.etag).toBe('E1')

    // Poll 2 — 304 Not Modified: nothing new delivered, etag retained.
    const { client: c2 } = mockClient({ listThrow: Object.assign(new Error('nm'), { status: 304 }) })
    cursor = await pollRepo(c2, ref, cursor, ctx, emit)
    expect(cursor.etag).toBe('E1')

    // Poll 3 — 200 with the old comment + a new one, etag E2.
    const { client: c3 } = mockClient({ listCommentsForRepo: [mk(1, 'alice'), mk(2, 'bob')], etag: 'E2' })
    cursor = await pollRepo(c3, ref, cursor, ctx, emit)
    expect(cursor.etag).toBe('E2')

    // Identical to pre-change behavior: id 1 once (dedup), id 2 once, 304 added nothing.
    expect(got).toEqual([1, 2])
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

  it('fails fast in webhook mode when App credentials are missing', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'gh-channel-itest-'))
    // Spawn with an isolated HOME so no real ~/.claude/channels/github/.env leaks in.
    const proc = spawn('bun', [SERVER_PATH], {
      env: {
        ...process.env,
        HOME: stateDir,
        CLAUDE_GITHUB_STATE_DIR: stateDir,
        CLAUDE_GITHUB_TRANSPORT: 'webhook',
        CLAUDE_GITHUB_REPOS: 'acme/app',
        CLAUDE_GITHUB_TOKEN: '',
        CLAUDE_GITHUB_APP_ID: '',
        CLAUDE_GITHUB_APP_PRIVATE_KEY: '',
        CLAUDE_GITHUB_APP_INSTALLATION_ID: '',
        CLAUDE_GITHUB_WEBHOOK_SECRET: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    try {
      let stderr = ''
      proc.stderr.on('data', (c: Buffer) => {
        stderr += c.toString()
      })
      const code: number = await new Promise(resolve => proc.on('exit', c => resolve(c ?? -1)))
      expect(code).not.toBe(0)
      expect(stderr).toMatch(/webhook transport requires/)
      expect(stderr).toMatch(/CLAUDE_GITHUB_APP_ID/)
    }
    finally {
      proc.kill()
      rmSync(stateDir, { recursive: true, force: true })
    }
  })
})
