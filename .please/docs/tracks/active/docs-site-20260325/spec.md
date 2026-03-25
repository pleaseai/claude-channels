# Documentation Site

> Track: docs-site-20260325

## Overview

Create a documentation site for the claude-channels project at `apps/docs` using Docus (Nuxt 4 + Nuxt UI + Nuxt Content). The site targets end users who want to set up and use claude-channels with their chat platforms. Deploy via Cloudflare Pages with direct Git integration.

## Requirements

### Functional Requirements

- [ ] FR-1: Initialize Docus project in `apps/docs` as a workspace package using `npx create-docus`
- [ ] FR-2: Configure Docus with project metadata (title, description, social links, GitHub repo URL) in `app.config.ts`
- [ ] FR-3: Create Getting Started guide covering installation, configuration, and quickstart
- [ ] FR-4: Configure Cloudflare Pages deployment (build command, output directory, environment variables)
- [ ] FR-5: Integrate `apps/docs` into the monorepo workspace and Turborepo pipeline

### Non-functional Requirements

- [ ] NFR-1: Site builds successfully with `bun run build` in the docs workspace
- [ ] NFR-2: Local development server runs with `bun run dev` in the docs workspace
- [ ] NFR-3: Build output (`.output/public`) compatible with Cloudflare Pages static hosting

## Acceptance Criteria

- [ ] AC-1: `apps/docs` is a valid workspace package in the monorepo
- [ ] AC-2: `bun run --filter docs dev` starts the local dev server at localhost:3000
- [ ] AC-3: `bun run --filter docs build` produces static output for Cloudflare Pages
- [ ] AC-4: Getting Started page is accessible at `/getting-started`
- [ ] AC-5: Cloudflare Pages deployment configuration is documented in README or deployment guide

## Out of Scope

- Plugin development guide (future track)
- API reference documentation (future track)
- Architecture overview (future track)
- Custom branding or theme modifications
- AI Assistant integration
- Internationalization (i18n)

## Tech Stack

- **Docus** (latest) — Nuxt 4 + Nuxt UI + Nuxt Content based documentation theme
- **Nuxt 4** — Framework
- **Nuxt Content** — MDC syntax for Markdown content
- **Cloudflare Pages** — Static hosting with Git integration

## Assumptions

- Docus installed as a Nuxt layer via `extends: ['docus']` in `nuxt.config.ts`
- Cloudflare Pages Git integration handles auto-deployment on push to main
- Documentation content uses Markdown/MDC format
- npm used as package manager for Docus compatibility (or bun if compatible)
