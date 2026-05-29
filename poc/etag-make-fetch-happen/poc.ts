/**
 * PoC — issue #11 option 3.
 *
 * Question: on the Bun runtime, can we get *transparent* ETag conditional
 * requests (If-None-Match / 304) by injecting `make-fetch-happen` as Octokit's
 * `request.fetch`, without ever touching a `RepoCursor.etag` field ourselves?
 *
 * What we prove (or disprove):
 *   1. make-fetch-happen imports + runs on Bun at all (its deps are Node-only:
 *      cacache, @npmcli/agent, ssri, minipass-fetch).
 *   2. Octokit accepts the minipass-fetch Response and parses it correctly.
 *   3. With `cache: 'no-cache'`, the 2nd+ identical call revalidates via 304
 *      and serves the cached body — surfaced as `x-local-cache-status: revalidated`.
 *   4. A revalidated (304) call does NOT consume GitHub REST quota
 *      (`x-ratelimit-used` stays flat across calls).
 *
 * Runs unauthenticated by default (60 req/h, enough for a spike). Set
 * CLAUDE_GITHUB_TOKEN or GITHUB_TOKEN to exercise the authenticated path.
 *
 * Usage:
 *   bun poc.ts                 # default target octocat/Hello-World
 *   bun poc.ts owner/repo      # custom public repo
 */

import { rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import makeFetchHappen from 'make-fetch-happen'
import { Octokit } from 'octokit'

const here = dirname(fileURLToPath(import.meta.url))
const cachePath = join(here, '.http-cache')

// Start from a clean cache so call #1 is a guaranteed MISS.
await rm(cachePath, { recursive: true, force: true })

const baseFetch = makeFetchHappen.defaults({
  cachePath,
  // The decisive setting: always create a conditional request when something is
  // cached (send If-None-Match), use the cached body when the origin answers 304.
  // NOTE: `cache: 'default'` would serve from local cache for up to GitHub's
  // max-age (~60s) WITHOUT hitting the network — wrong for a 5s poll loop.
  cache: 'no-cache',
})

let networkCalls = 0
const instrumentedFetch = ((url: string, opts: unknown) => {
  networkCalls++
  return (baseFetch as unknown as (u: string, o: unknown) => Promise<Response>)(url, opts).then((res) => {
    const cacheStatus = res.headers.get('x-local-cache-status')
    // Does the Response handed back by make-fetch-happen still carry GitHub's
    // rate-limit headers on a revalidated (304) call? This is what requirement
    // (b) needs to read on EVERY response.
    process.stderr.write(
      `    ↳ fetch boundary: http.status=${res.status} x-local-cache-status=${cacheStatus ?? '(none)'} `
      + `ratelimit-remaining=${res.headers.get('x-ratelimit-remaining') ?? '(absent)'} `
      + `ratelimit-used=${res.headers.get('x-ratelimit-used') ?? '(absent)'}\n`,
    )
    return res
  })
}) as unknown as typeof fetch

const token = process.env.CLAUDE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN
const octokit = new Octokit({
  ...(token ? { auth: token } : {}),
  request: { fetch: instrumentedFetch },
})

const target = process.argv[2] ?? 'octocat/Hello-World'
const slash = target.indexOf('/')
const owner = target.slice(0, slash)
const repo = target.slice(slash + 1)

interface Snapshot {
  status: number
  etag?: string
  remaining?: string
  used?: string
  cache?: string
  fullName?: string
}

const snapshots: Snapshot[] = []

async function poll(label: string): Promise<void> {
  const res = await octokit.rest.repos.get({ owner, repo })
  const h = res.headers as Record<string, string | undefined>
  const snap: Snapshot = {
    status: res.status,
    etag: h.etag,
    remaining: h['x-ratelimit-remaining'],
    used: h['x-ratelimit-used'],
    cache: h['x-local-cache-status'],
    fullName: (res.data as { full_name?: string }).full_name,
  }
  snapshots.push(snap)
  process.stderr.write(
    `${label}\n`
    + `    octokit.status=${snap.status} full_name=${snap.fullName}\n`
    + `    etag=${snap.etag}\n`
    + `    x-local-cache-status=${snap.cache ?? '(none)'} `
    + `ratelimit-used=${snap.used} ratelimit-remaining=${snap.remaining}\n\n`,
  )
}

process.stderr.write(`PoC: octokit.js + make-fetch-happen on Bun ${Bun.version}\n`)
process.stderr.write(`Auth: ${token ? 'token' : 'unauthenticated (60 req/h)'}\n`)
process.stderr.write(`Target: ${owner}/${repo} via rest.repos.get\n`)
process.stderr.write(`Cache: ${cachePath} (cleared)\n\n`)

await poll('call #1  — cold cache  → expect MISS, 200 from network')
await poll('call #2  — warm cache  → expect REVALIDATED (304), used flat')
await poll('call #3  — warm cache  → expect REVALIDATED (304), used flat')

/* ----------------------------- verdict ----------------------------- */

const [c1, c2, c3] = snapshots
const revalidated2 = c2?.cache === 'revalidated'
const revalidated3 = c3?.cache === 'revalidated'
const dataIntact = c2?.fullName === c1?.fullName && c3?.fullName === c1?.fullName
const allOk200 = snapshots.every(s => s.status === 200)
// Quota: revalidated 304 calls must not increase x-ratelimit-used.
const usedFlat
  = c1?.used !== undefined && c2?.used !== undefined
    ? Number(c2.used) <= Number(c1.used) && Number(c3?.used) <= Number(c1.used)
    : undefined

process.stderr.write('────────────────────────── VERDICT ──────────────────────────\n')
process.stderr.write(`  make-fetch-happen runs on Bun ............... PASS (got here)\n`)
process.stderr.write(`  octokit parses minipass-fetch Response ...... ${allOk200 && dataIntact ? 'PASS' : 'FAIL'}\n`)
process.stderr.write(`  call#2 revalidated via 304 .................. ${revalidated2 ? 'PASS' : 'FAIL'}\n`)
process.stderr.write(`  call#3 revalidated via 304 .................. ${revalidated3 ? 'PASS' : 'FAIL'}\n`)
process.stderr.write(`  cached body served intact on 304 ........... ${dataIntact ? 'PASS' : 'FAIL'}\n`)
process.stderr.write(
  `  304 does not consume REST quota ............. ${
    usedFlat === undefined ? 'N/A (no ratelimit-used header)' : usedFlat ? 'PASS' : 'FAIL'
  }\n`,
)
process.stderr.write(`  total fetch() calls into make-fetch-happen .. ${networkCalls}\n`)
process.stderr.write('──────────────────────────────────────────────────────────────\n')

const verdictOk = allOk200 && dataIntact && revalidated2 && revalidated3
process.stderr.write(
  verdictOk
    ? '\n✅ Option 3 is viable on Bun: transparent ETag/304 with zero manual etag bookkeeping.\n'
    : '\n❌ Option 3 has a problem on Bun — see failing line(s) above; fall back to manual hook (option 1).\n',
)
process.exit(verdictOk ? 0 : 1)
