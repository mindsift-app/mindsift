import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's 5 s per test fails heavy component tests (user list, setup wizard, code editor) when the
    // machine is busy, e.g. ci/local-checks.sh beside other builds; a passing test is not slowed by it
    testTimeout: 30_000,
  },
});
