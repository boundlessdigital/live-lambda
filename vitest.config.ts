import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/cdk/layer/**',
        'src/**/types.ts',       // Type-only files have no runtime code
        'src/cli/index.ts',      // CLI entry point (Commander.js wiring)
        'src/cdk/toolkit/**',    // CDK Toolkit I/O customization
        'src/index.ts'           // Re-export barrel file
      ]
    },
    testTimeout: 30000,
    hookTimeout: 30000
  }
})
