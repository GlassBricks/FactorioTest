import { test as base } from "vitest"
import { createTestDirs, removeTestDirs, TestDirs } from "./test-utils.js"

export const test = base.extend<{ dirs: TestDirs }>({
  dirs: async ({ task }, use) => {
    const dirs = await createTestDirs(task.name.replace(/\W+/g, "-").slice(0, 20))
    await use(dirs)
    await removeTestDirs(dirs)
  },
})
