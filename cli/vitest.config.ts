import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["factorio-test-data-dir/**", "node_modules/**"],
  },
})
