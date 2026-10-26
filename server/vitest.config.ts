import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node', testTimeout: 30000, hookTimeout: 120000, fileParallelism: false,
    include: ['tests/**/*.test.ts'],
    env: { NODE_ENV: 'test', JWT_SECRET: 'test-secret-test-secret-test-secret-123', UPLOAD_DIR: '.test-uploads', ANTHROPIC_API_KEY: '' },
  },
});

