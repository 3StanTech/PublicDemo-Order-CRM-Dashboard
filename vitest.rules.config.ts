import { defineConfig } from 'vitest/config'

// Emulator-backed rules suite. Run through `npm run test:rules`, which starts
// the Firestore emulator and sets FIRESTORE_EMULATOR_HOST.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/rules/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})
