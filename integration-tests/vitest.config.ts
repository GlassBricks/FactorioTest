import * as os from "os"
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 180_000,
    maxWorkers: Math.max(1, Math.floor((os.cpus().length * 3) / 4)),
    sequence: { concurrent: true },
    maxConcurrency: 10,
  },
})
