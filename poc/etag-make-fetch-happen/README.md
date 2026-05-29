# PoC — ETag conditional requests via `octokit.js` + `make-fetch-happen` (issue #11, option 3)

Spike to decide how to implement [#11](https://github.com/pleaseai/claude-channels/issues/11)
(ETag conditional requests + rate-limit-aware backoff) in `plugins/github/server.ts`.

**Question:** Can we get *transparent* `If-None-Match`/304 conditional requests —
with **zero** manual `RepoCursor.etag` bookkeeping — by injecting
[`make-fetch-happen`](https://github.com/npm/make-fetch-happen) as Octokit's
`request.fetch`, and does it work on the **Bun** runtime?

## Run

```bash
bun install
bun poc.ts                 # unauthenticated, target octocat/Hello-World (60 req/h)
bun poc.ts owner/repo      # any public repo
CLAUDE_GITHUB_TOKEN=… bun poc.ts owner/repo   # authenticated path
```

Each run clears the on-disk cache, then calls `rest.repos.get` three times and
prints what happened at both the fetch boundary and the Octokit layer.

## Result (Bun 1.3.14, unauthenticated)

| Check | Result |
|---|---|
| `make-fetch-happen` imports + runs on Bun (Node-only deps: cacache, @npmcli/agent, ssri, minipass-fetch) | ✅ PASS |
| Octokit parses the minipass-fetch `Response` (status 200, `data` intact) | ✅ PASS |
| `cache: 'no-cache'` → 2nd/3rd calls revalidate via **304** (`x-local-cache-status: revalidated`) | ✅ PASS |
| Cached body served transparently on 304 (Octokit still sees `200` + correct `data`) | ✅ PASS |
| **No `RepoCursor.etag` field needed** — caching layer owns the ETag | ✅ PASS |

### ⚠️ Decisive finding for requirement (b)

**On a revalidated (304) response, GitHub's `x-ratelimit-*` headers are NOT surfaced** —
absent even at the raw fetch boundary:

```
call #1  miss         ratelimit-remaining=36 ratelimit-used=24   ← present on cold 200
call #2  revalidated  ratelimit-remaining=(absent) used=(absent) ← 304 headers dropped
call #3  revalidated  ratelimit-remaining=(absent) used=(absent)
```

make-fetch-happen serves the *cached* response and does not merge the fresh 304's
headers. So the **proactive rate-limit backoff** half of #11 loses its data source
**exactly on the common path** (a "no new comments" poll is a 304).

## Conclusions

1. **Requirement (a) — ETag/304: SOLVED, elegantly.** `make-fetch-happen` +
   `cache: 'no-cache'` makes conditional requests transparent on Bun. The
   `RepoCursor.etag` reintroduction the issue describes becomes unnecessary; the
   HTTP cache owns it. GitHub does not count 304s against the primary rate limit,
   so quota is saved.

2. **Requirement (b) — proactive rate-limit backoff: NOT solved by this layer,
   and partially *obstructed* by it.** Because `x-ratelimit-remaining` is hidden
   on 304s, reading it off the poll response is unreliable. Recommended path:
   drive proactive backoff from a separate **`GET /rate_limit`** call (that
   endpoint does **not** consume quota), and still honor `Retry-After` on
   429 / secondary-limit responses (those are >= 400, pass through uncached).

3. **`cache` mode matters.** Use `cache: 'no-cache'` (always revalidate). Never
   `cache: 'default'` — it would serve from the local cache for up to GitHub's
   `max-age` (~60s) **without hitting the network**, making the 5s poll loop miss
   new comments for up to a minute.

4. **Caveats before adopting in the plugin:**
   - Adds ~100+ transitive deps (cacache, minipass family, …) — tension with the
     repo's single-file / self-contained plugin convention.
   - On-disk cache dir must live under `~/.claude/channels/github/` and is managed
     by cacache (not the repo's tmp+rename atomic-write convention).
   - The issue's literal task "treat 304 as clean no-new-items, skip processing"
     is satisfied differently: the cached body is re-handed to the poller and the
     existing `Dedup` absorbs it. Functionally equivalent, wording differs.

### GitHub App support (planned)

Orthogonal to the fetch layer. `octokit.js` (used here) bundles App auth
(`createAppAuth` / `App`), so moving off `@octokit/rest` to `octokit.js` is
compatible with — and independent of — the make-fetch-happen decision. App auth
also raises the rate-limit ceiling, softening (but not removing) the motivation
for requirement (b)'s proactive backoff (secondary limits still apply).

## Recommendation

- Adopt **`make-fetch-happen` for (a)** *if* the added dependency weight is
  acceptable; otherwise implement (a) with a manual `octokit.hook.after` ETag
  store (option 1) — both are now proven viable.
- Implement **(b) independently** via `GET /rate_limit` polling + `Retry-After`
  on 429, regardless of which (a) path is chosen.
