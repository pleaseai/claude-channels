const GITHUB_URL = 'https://github.com/pleaseai/claude-channels'

export default defineAppConfig({
  header: {
    title: 'claude-channels',
  },
  seo: {
    title: 'claude-channels',
    description: 'Bridge chat platforms with Claude Code sessions via MCP channel plugins.',
  },
  socials: {
    github: GITHUB_URL,
  },
  github: {
    url: GITHUB_URL,
    branch: 'main',
    rootDir: 'apps/docs',
  },
  toc: {
    title: 'On this page',
  },
})
