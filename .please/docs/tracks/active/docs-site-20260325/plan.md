# Plan: Documentation Site

> Track: docs-site-20260325
> Spec: [spec.md](./spec.md)

## Overview

- **Source**: .please/docs/tracks/active/docs-site-20260325/spec.md
- **Issue**: TBD
- **Created**: 2026-03-25
- **Approach**: Pragmatic

## Purpose

After this change, end users will be able to read Getting Started documentation for claude-channels at a public Cloudflare Pages URL. They can verify it works by visiting the deployed site and navigating to the Getting Started guide.

## Context

The claude-channels project currently has no documentation site. End users need a place to learn how to install, configure, and use the channel plugins. The project is a Bun monorepo with Turborepo, currently containing only `plugins/*` workspaces. We need to add an `apps/docs` workspace using Docus (Nuxt 4 + Nuxt UI + Nuxt Content) and configure Cloudflare Pages for deployment.

The root `package.json` workspaces array only includes `plugins/*`, so `apps/*` must be added. Turborepo build outputs are configured as `dist/**`, but Docus/Nuxt outputs to `.output/public` — this requires a package-level turbo config override.

### Non-goals

- Plugin development guide, API reference, architecture docs (future tracks)
- Custom branding or theme modifications
- AI Assistant or i18n features

## Architecture Decision

Use Docus as a Nuxt layer (`extends: ['docus']`) in a new `apps/docs` workspace package. This is the standard Docus setup and integrates cleanly with the existing monorepo. Cloudflare Pages will use direct Git integration pointing to the `apps/docs` directory with `bun run build` as the build command and `.output/public` as the output directory.

Docus was chosen because it provides a complete documentation solution (navigation, search, dark mode, typography) out of the box with zero configuration beyond content files.

## Tasks

- [x] T001 Add `apps/*` to root workspace configuration (file: package.json)
- [x] T002 Initialize Docus project in apps/docs (file: apps/docs/package.json)
- [x] T003 Configure Docus app config with project metadata (file: apps/docs/app.config.ts) (depends on T002)
- [x] T004 Configure Nuxt for static generation and Cloudflare Pages (file: apps/docs/nuxt.config.ts) (depends on T002)
- [x] T005 Create index landing page content (file: apps/docs/content/index.md) (depends on T002)
- [x] T006 Create Getting Started guide content (file: apps/docs/content/1.getting-started/1.introduction.md) (depends on T002)
- [x] T007 Add Turborepo build config for docs package (file: apps/docs/turbo.json) (depends on T002)
- [x] T008 Verify build output and dev server work (depends on T001, T002, T003, T004, T005, T006, T007)

## Key Files

### Create

- `apps/docs/package.json` — Workspace package with Docus dependency
- `apps/docs/nuxt.config.ts` — Nuxt config extending Docus layer
- `apps/docs/app.config.ts` — Docus theme config (title, social links, GitHub)
- `apps/docs/content/index.md` — Landing page
- `apps/docs/content/1.getting-started/1.introduction.md` — Getting Started guide
- `apps/docs/turbo.json` — Package-level Turborepo config with `.output/public` output

### Modify

- `package.json` — Add `apps/*` to workspaces array

### Reuse

- `turbo.json` — Root Turborepo config (no changes needed, package-level override handles outputs)
- `.please/docs/references/docus-llms.txt` — Docus documentation reference

## Verification

### Automated Tests

- [ ] `bun run --filter docs build` completes without errors
- [ ] Build output exists at `apps/docs/.output/public/index.html`

### Observable Outcomes

- Running `bun run --filter docs dev` starts dev server at http://localhost:3000
- After navigating to `/getting-started/introduction`, the Getting Started guide is visible
- After running `bun run --filter docs build`, `.output/public/` contains static HTML files

### Manual Testing

- [ ] Dev server renders landing page with project title
- [ ] Getting Started guide page loads and displays content
- [ ] Navigation sidebar shows correct structure

### Acceptance Criteria Check

- [ ] AC-1: `apps/docs` is a valid workspace package in the monorepo
- [ ] AC-2: `bun run --filter docs dev` starts local dev server
- [ ] AC-3: `bun run --filter docs build` produces static output
- [ ] AC-4: Getting Started page accessible at `/getting-started/introduction`
- [ ] AC-5: Cloudflare Pages config documented

## Decision Log

- Decision: Use Docus as Nuxt layer rather than standalone project
  Rationale: Cleaner monorepo integration, standard Docus setup pattern
  Date/Author: 2026-03-25 / Claude

- Decision: Package-level turbo.json for output directory override
  Rationale: Root turbo.json uses `dist/**` but Nuxt outputs to `.output/public`
  Date/Author: 2026-03-25 / Claude

- Decision: Use npm instead of Bun workspace for docs
  Rationale: Bun's .bun/ path layout causes Nitro's oxc transpiler to skip Docus TS files, breaking the build. Confirmed community workaround.
  Date/Author: 2026-03-25 / Claude

## Outcomes & Retrospective

### What Was Shipped
- Docus documentation site at `apps/docs` with landing page and Getting Started guide
- Static generation via `nuxt generate` producing Cloudflare Pages compatible output
- Developer gotchas documented in `apps/docs/CLAUDE.md`

### What Went Well
- Docus provides excellent out-of-box documentation features (nav, search, dark mode)
- Build produces clean static HTML suitable for any static hosting
- Review cycle caught documentation inaccuracies (pairing flow, MCP path)

### What Could Improve
- Bun/Docus incompatibility cost significant debugging time; should research tooling compatibility earlier
- ESLint markdown formatter breaking MDC syntax was unexpected; need to exclude content dirs from formatters upfront

### Tech Debt Created
- `apps/docs` is not part of Bun workspaces or Turborepo pipeline — manual `cd apps/docs && npm run build` required
- `@nuxt/devalue` added as explicit dependency to work around transitive resolution issue (may be fixed upstream)
