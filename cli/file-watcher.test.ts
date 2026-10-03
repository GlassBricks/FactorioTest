import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { matchesPattern, watchDirectory } from "./file-watcher.js"

describe("matchesPattern", () => {
  const defaultPatterns = ["info.json", "**/*.lua"]

  it.each([
    ["info.json", defaultPatterns, true],
    ["control.lua", defaultPatterns, true],
    ["nested/file.lua", defaultPatterns, true],
    ["deeply/nested/module.lua", defaultPatterns, true],
    ["data.ts", defaultPatterns, false],
    ["settings.json", defaultPatterns, false],
    ["info.json.bak", defaultPatterns, false],
    ["some/info.json", defaultPatterns, false],
  ])("matchesPattern(%j, %j) => %j", (filename, patterns, expected) => {
    expect(matchesPattern(filename, patterns)).toBe(expected)
  })

  it("handles custom patterns", () => {
    expect(matchesPattern("src/main.ts", ["**/*.ts"])).toBe(true)
    expect(matchesPattern("main.ts", ["**/*.ts"])).toBe(true)
    expect(matchesPattern("main.js", ["**/*.ts"])).toBe(false)
  })

  it("handles single wildcard", () => {
    expect(matchesPattern("file.lua", ["*.lua"])).toBe(true)
    expect(matchesPattern("nested/file.lua", ["*.lua"])).toBe(false)
  })

  it("handles backslash paths (Windows)", () => {
    expect(matchesPattern("nested\\file.lua", defaultPatterns)).toBe(true)
  })
})

describe("watchDirectory", () => {
  let dir: string
  let watcher: fs.FSWatcher | undefined

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "factorio-test-watch-"))
    fs.writeFileSync(path.join(dir, "control.lua"), "")
  })

  afterEach(() => {
    watcher?.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  const settle = () => new Promise((resolve) => setTimeout(resolve, 200))

  // macOS FSEvents can deliver events from before the watcher started, e.g. the fixture creation in beforeEach
  async function watch(): Promise<{ changes: () => number }> {
    let count = 0
    watcher = watchDirectory(dir, () => count++, { patterns: ["info.json", "**/*.lua"], debounceMs: 50 })
    await settle()
    count = 0
    return { changes: () => count }
  }

  it("fires once for a burst of matching changes", async () => {
    const { changes } = await watch()
    fs.writeFileSync(path.join(dir, "control.lua"), "-- 1")
    fs.writeFileSync(path.join(dir, "control.lua"), "-- 2")
    fs.mkdirSync(path.join(dir, "nested"))
    fs.writeFileSync(path.join(dir, "nested", "module.lua"), "")
    await settle()
    expect(changes()).toBe(1)
  })

  it("ignores files not matching the patterns", async () => {
    const { changes } = await watch()
    fs.writeFileSync(path.join(dir, "test.ts"), "// test file")
    await settle()
    expect(changes()).toBe(0)
  })
})
