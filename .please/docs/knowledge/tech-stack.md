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

| Platform | SDK                                    | Protocol    |
| -------- | -------------------------------------- | ----------- |
| Slack    | `@slack/web-api`, `@slack/socket-mode` | Socket Mode |
| Line     | TBD                                    | TBD         |

## Monorepo

- **Bun workspaces** — Package management and dependency hoisting
- **Turborepo** — Task orchestration, caching, and pipeline management

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
