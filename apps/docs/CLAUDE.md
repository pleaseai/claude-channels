# apps/docs

Documentation site for claude-channels using Docus (Nuxt 4 + Nuxt Content).

## Commands

```bash
cd apps/docs
npm install       # Install dependencies (must use npm, NOT bun)
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Generate static site to .output/public/
npm run preview   # Preview built site
```

## Gotchas

### Must use npm, not Bun, for dependency management

Bun's `.bun/` path layout causes Nitro's oxc transpiler to skip TypeScript files from Docus (it excludes `node_modules/` paths). This breaks `rollup-plugin-inject` which can't parse raw TypeScript. The confirmed workaround is to use npm for this workspace.

- **Do**: `cd apps/docs && npm install`
- **Don't**: Add `apps/*` to root `package.json` workspaces — this causes `bun install` to manage docs dependencies with the `.bun/` symlink layout
- **Upstream**: https://github.com/nuxt/nuxt/issues/28995

### Not part of Bun workspaces

The `apps/docs` package is intentionally excluded from the root `package.json` workspaces array. This means Turborepo does NOT discover it as a workspace package — `turbo run build` at the root will not build docs. Build and dev must be run directly: `cd apps/docs && npm run build`.

### Nuxt build artifacts

Build output goes to `.output/public/` (not `dist/`). The package-level `turbo.json` overrides the root config's `dist/**` output to `.output/public/**`.

### Content file naming

Docus uses numeric prefixes for ordering: `1.getting-started/1.introduction.md` renders at `/getting-started/introduction`. The number prefix is stripped from the URL.
