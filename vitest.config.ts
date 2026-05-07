import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup/vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    unstubGlobals: true,
  },
});
