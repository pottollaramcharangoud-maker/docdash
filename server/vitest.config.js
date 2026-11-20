import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    testTimeout: 10000,
    // Each file gets its own process → isolated DB when DB_PATH is unique per file
    pool: "forks",
  },
});
