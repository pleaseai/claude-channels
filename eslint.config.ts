import antfu from '@antfu/eslint-config'

export default antfu({
  type: 'lib',
  typescript: true,
  formatters: true,
  ignores: [
    'vendor/**',
    'apps/docs/.output/**',
    'apps/docs/content/**',
    // Throwaway investigation spikes — standalone Bun scripts, intentionally use
    // top-level await + process globals; not shipped into any plugin.
    'poc/**',
  ],
})
