/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true, // Use Vitest's global APIs
    environment: 'node', // Specify Node.js environment for tests
    // You can add more configuration here as needed
  },
})
