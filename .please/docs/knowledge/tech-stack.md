# Tech Stack

## Runtime

- **Bun** 1.3.10 — JavaScript/TypeScript runtime, package manager, and test runner
- **Node.js** 24 — Required for some tooling (commitlint, etc.)

## Language

- **TypeScript** — ESNext target, strict mode, bundler module resolution
- **ESM** — `type: module` throughout all packages

## Protocol

- **MCP SDK** (`@modelcontextprotocol/sdk`) — Model Context Protocol for Claude Code channel integration

## Platform SDKs

| Platform | SDK                                    | Protocol                            |
| -------- | -------------------------------------- | ----------------------------------- |
| Slack    | `@slack/web-api`, `@slack/socket-mode` | Socket Mode                         |
| Line     | TBD                                    | TBD                                 |
| GitHub   | `@octokit/rest`, `@octokit/auth-app`   | REST polling (PAT) or webhook (App) |

### GitHub transports

The GitHub channel supports two opt-in inbound transports, selected via
`CLAUDE_GITHUB_TRANSPORT` (default `poll`):

- **`poll`** (default) — fine-grained PAT + `@octokit/rest` REST polling. No
  public URL required.
- **`webhook`** — GitHub App installation auth (`@octokit/auth-app`) + a local
  signed webhook receiver exposed through a **Cloudflare tunnel** (`cloudflared`
  external binary; quick/ephemeral by default, or a persistent named tunnel).
  Signatures are verified with `node:crypto` HMAC-SHA256. Deploying the receiver
  to Cloudflare (hosted Worker/service) is a future enhancement, not yet
  implemented.

## Monorepo

- **Bun workspaces** — Package management and dependency hoisting
- **Turborepo** — Task orchestration, caching, and pipeline management

## Documentation

- **Docus** (latest) — Nuxt 4 + Nuxt UI + Nuxt Content documentation theme
- **Nuxt 4** — Framework for the documentation site
- **Cloudflare Pages** — Static hosting with Git integration
- **npm** — Package manager for `apps/docs` (Bun workspace incompatible with Docus build)

## Development Tools

| Tool       | Purpose                                                |
| ---------- | ------------------------------------------------------ |
| ESLint     | Linting (@antfu/eslint-config)                         |
| commitlint | Conventional commit enforcement                        |
| mise       | Tool version management (Bun, Node) and git hook tasks |
| TypeScript | Type checking (noEmit, strict)                         |

## Tool Versions

Managed via `.mise.toml`:

```toml
[tools]
bun = "1.3.10"
node = "24"
```
