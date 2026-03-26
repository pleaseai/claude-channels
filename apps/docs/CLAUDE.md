# apps/docs

Documentation site for claude-channels using Docus (Nuxt 4 + Nuxt Content).

## Commands

```bash
bun install --linker hoisted   # Install dependencies (must use hoisted linker)
bun run dev                    # Start dev server at http://localhost:3000
bun run build                  # Generate static site to dist/
bun run preview                # Preview built site
```

## Deployment (Cloudflare Pages)

- **Root directory**: `apps/docs`
- **Build command**: `bun install --linker hoisted && bun run build`
- **Build output directory**: `.output/public`

## Gotchas

### Must use `--linker hoisted` with Bun

Bun's default isolated linker stores packages under `node_modules/.bun/` via symlinks. Nitro's oxc transpiler skips TypeScript files from these paths, breaking Docus server-side `.ts` files. The `--linker hoisted` flag places packages directly in `node_modules/` without the `.bun/` indirection.

- **Do**: `bun install --linker hoisted`
- **Don't**: `bun install` (without `--linker hoisted`) — causes Rollup parse errors on Docus TypeScript files
- **Upstream**: https://github.com/nuxt/nuxt/issues/28995

### Part of Bun workspaces

The `apps/docs` package is included in the root `package.json` workspaces (`apps/*`). Turborepo discovers it, but the hoisted linker flag must be used when installing.

### Nuxt build artifacts

Static generation output goes to `.output/public/`.

### Content file naming

Docus uses numeric prefixes for ordering: `1.getting-started/1.introduction.md` renders at `/getting-started/introduction`. The number prefix is stripped from the URL.
