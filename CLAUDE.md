# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

claude-channels — a collection of MCP channel plugins bridging chat platforms (Slack, Line, etc.) with Claude Code sessions. Each plugin is a single-file MCP server (`server.ts`) that runs as a local subprocess.

## Commands

```bash
# Setup
mise install            # Install Bun 1.3.10 + Node 24
bun install             # Install dependencies
mise run setup          # Install git hooks (pre-commit lint + commit-msg validation)

# Development
bun run --filter claude-channel-slack dev   # Run Slack plugin in dev mode

# Testing
bun test                                    # Run all tests
bun test --coverage                         # Run with coverage report
bun test plugins/slack/                     # Run tests for a specific plugin

# Linting & Checks
bun run lint                                # ESLint check
bun run lint:fix                            # ESLint auto-fix
turbo check                                 # Run all checks (build + typecheck)
bun run build                               # Build all packages via Turborepo
```

## Architecture

Each plugin is fully self-contained in `plugins/<platform>/server.ts` — MCP server, platform client, access control, and tools all in one file. Plugins do NOT share code or import from each other.

Key invariants:

- **Sender gating**: Access control gates on `message.user` (sender identity), never channel/room ID
- **Outbound gating**: Tools (`reply`, `react`, `edit_message`) verify target chat is allowlisted before sending
- **State directory**: Runtime state lives in `~/.claude/channels/<platform>/` (access.json, .env, inbox/) — NOT in the project directory
- **Atomic writes**: State files written via tmp + rename, never directly
- **Logging**: stderr only (stdout is MCP stdio transport)

Reference implementations in `vendor/claude-plugins-official/external_plugins/` (Discord, Telegram, fakechat) are the authoritative patterns for how channel plugins should work.

## Monorepo

Bun workspaces + Turborepo. Workspaces: `plugins/*`, `apps/*`. Each plugin has its own `package.json`. Root `turbo.json` defines the task pipeline (build, check, lint).

## Project Knowledge

See [.please/INDEX.md](.please/INDEX.md) for full index.

- [Product definition](.please/docs/knowledge/product.md) — Vision, users, core features
- [Tech stack](.please/docs/knowledge/tech-stack.md) — Runtime, SDKs, tooling
- [Workflow](.please/docs/knowledge/workflow.md) — TDD lifecycle, quality gates, dev commands
- [Tracks](.please/docs/tracks/index.md) — Active implementation tracks (spec + plan)
- [Decisions](.please/docs/decisions/) — Architecture Decision Records
- [References](.please/docs/references/) — External reference materials (llms.txt, etc.)

## Conventions

- **TypeScript**: ESNext target, strict mode, bundler module resolution, ESM (`type: module`)
- **Linting**: @antfu/eslint-config with `type: 'lib'`
- **Commits**: Conventional commits enforced by commitlint. `subject-case` rule is disabled.
- **Git hooks**: Managed by mise (pre-commit runs lint, commit-msg runs commitlint)
- **TDD**: Write failing tests first, then implement. Target >80% coverage for new code.
