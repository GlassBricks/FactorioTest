# CLI Schema-First Refactoring Plan

## Overview

Refactor the CLI to use Zod as the single source of truth for configuration options. This eliminates manual synchronization between type definitions, validation keys, and CLI option definitions while enabling focused unit testing without requiring Factorio.

## Current State Analysis

**Four sources of truth that must stay in sync manually:**
1. `validCliConfigKeys` / `validTestConfigKeys` Sets in `cli/config.ts` (string literals)
2. `TestRunnerConfig` interface in `types/config.d.ts`
3. Commander `.option()` calls in `cli/run.ts:22-50`
4. `options` parameter type in `runTests()` function at `cli/run.ts:65-80`

**Naming convention flow:**
- CLI: kebab-case (`--game-speed`) → converted to snake_case
- Config files: snake_case (`game_speed`)
- Internal/Lua: snake_case (`game_speed`)

**Monolithic structure:**
- `cli/run.ts` (399 lines) handles parsing, config, setup, and execution
- No unit tests exist - only integration tests requiring Factorio

### Key Discoveries:
- `types/config.d.ts:1-9` - Public API uses snake_case (required for Lua/mod compatibility)
- `cli/run.ts:121-128` - Manual camelCase→snake_case mapping from Commander output
- `cli/config.ts:17-37` - Validation keys duplicated: camelCase for CLI config, snake_case for test config
- `mod/factorio-test/config.ts:4-8` - Mod reads config via `helpers.json_to_table()` expecting snake_case

## Desired End State

Single Zod schema defines all CLI and test config options. From this schema:
- TypeScript types derived via `z.infer<>`
- Config validation uses `schema.parse()`
- Valid keys derived via `Object.keys(schema.shape)`
- CLI options generated from schema metadata

**Verification:**
- Adding a new option requires only one schema change
- Unit tests cover config parsing, merging, and path detection
- All existing integration tests pass

## What We're NOT Doing

- Switching CLI framework (Commander is fine)
- Changing the snake_case convention (required for Lua)
- Modifying mod-side code
- Adding new CLI features

## Implementation Approach

Use snake_case consistently throughout. Only conversion needed is CLI kebab-case → snake_case:

```
Config File (snake_case)     CLI Options (kebab-case)
        │                            │
        ▼                            ▼
  schema.parse()             parseCliTestOptions()
        │                            │
        └──────────┬─────────────────┘
                   ▼
         Internal: snake_case (schema)
                   │
                   ▼
         Factorio Settings (snake_case, no conversion)
```

Generate Commander options programmatically from schema metadata.

---

## Phase 1: Add Zod and Create Schema

### Overview
Add Zod dependency and create the schema definition file that will serve as single source of truth. Schema uses snake_case keys matching `types/config.d.ts`.

### Changes Required:

#### 1. Add Zod dependency
**File**: `cli/package.json`
**Changes**: Add zod to dependencies

```json
"dependencies": {
  "chalk": "^5.6.2",
  "commander": "^12.1.0",
  "factoriomod-debug": "^2.0.10",
  "zod": "^3.24.0"
}
```

#### 2. Create schema definition
**File**: `cli/schema.ts` (new file)
**Changes**: Define schemas with snake_case keys and CLI metadata

```typescript
import { z } from "zod"
import type { Command } from "commander"
import type { TestRunnerConfig as PublicTestRunnerConfig } from "../types/config.js"

export const testRunnerConfigSchema = z.object({
  test_pattern: z.string().optional(),
  tag_whitelist: z.array(z.string()).optional(),
  tag_blacklist: z.array(z.string()).optional(),
  default_timeout: z.number().int().positive().optional(),
  game_speed: z.number().int().positive().optional(),
  log_passed_tests: z.boolean().optional(),
  log_skipped_tests: z.boolean().optional(),
})

export type TestRunnerConfig = z.infer<typeof testRunnerConfigSchema>

// Compile-time check that schema matches public interface
const _typeCheck: PublicTestRunnerConfig = {} as TestRunnerConfig
void _typeCheck

export const cliConfigSchema = z.object({
  modPath: z.string().optional(),
  modName: z.string().optional(),
  factorioPath: z.string().optional(),
  dataDirectory: z.string().optional(),
  mods: z.array(z.string()).optional(),
  verbose: z.boolean().optional(),
  showOutput: z.boolean().optional(),
  factorioArgs: z.array(z.string()).optional(),
  test: testRunnerConfigSchema.optional(),
})

export type CliConfig = z.infer<typeof cliConfigSchema>

interface CliOptionMeta {
  flags: string
  description: string
  parseArg?: (value: string) => unknown
}

const testRunnerCliOptions: Record<keyof TestRunnerConfig, CliOptionMeta> = {
  test_pattern: { flags: "--test-pattern <pattern>", description: "Pattern to filter tests" },
  tag_whitelist: { flags: "--tag-whitelist <tags...>", description: "Only run tests with these tags" },
  tag_blacklist: { flags: "--tag-blacklist <tags...>", description: "Skip tests with these tags" },
  default_timeout: { flags: "--default-timeout <ticks>", description: "Default test timeout in ticks", parseArg: parseInt },
  game_speed: { flags: "--game-speed <speed>", description: "Game speed multiplier", parseArg: parseInt },
  log_passed_tests: { flags: "--log-passed-tests", description: "Log passed test names" },
  log_skipped_tests: { flags: "--log-skipped-tests", description: "Log skipped test names" },
}

export function registerTestRunnerOptions(command: Command): void {
  for (const [key, meta] of Object.entries(testRunnerCliOptions)) {
    if (meta.parseArg) {
      command.option(meta.flags, meta.description, meta.parseArg)
    } else {
      command.option(meta.flags, meta.description)
    }
    if (key === "log_passed_tests") {
      command.option("--no-log-passed-tests", "Don't log passed test names")
    }
  }
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function parseCliTestOptions(opts: Record<string, unknown>): Partial<TestRunnerConfig> {
  const result: Partial<TestRunnerConfig> = {}
  for (const snake of Object.keys(testRunnerConfigSchema.shape) as (keyof TestRunnerConfig)[]) {
    const camel = snakeToCamel(snake)
    if (opts[camel] !== undefined) {
      result[snake] = opts[camel] as TestRunnerConfig[typeof snake]
    }
  }
  return result
}
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run build --workspace=cli`
- [x] Linting passes: `npm run lint --workspace=cli`
- [x] Schema types match existing interface (verified by compile-time check)

#### Manual Verification:
- [x] Review schema.ts structure is clean and readable

---

## Phase 2: Refactor config.ts to Use Schema

### Overview
Replace manual validation Sets with schema-based validation. Config files use snake_case directly (no conversion needed).

### Changes Required:

#### 1. Refactor config.ts
**File**: `cli/config.ts`
**Changes**: Use schema for validation, remove manual key sets

```typescript
import * as fs from "fs"
import * as path from "path"
import { cliConfigSchema, type CliConfig, type TestRunnerConfig } from "./schema.js"
import { ZodError } from "zod"

function formatZodError(error: ZodError, filePath: string): string {
  const issues = error.issues.map((issue) => {
    const pathStr = issue.path.join(".")
    return `  - ${pathStr ? `"${pathStr}": ` : ""}${issue.message}`
  })
  return `Invalid config in ${filePath}:\n${issues.join("\n")}`
}

export function loadConfig(configPath?: string): CliConfig {
  const paths = configPath
    ? [path.resolve(configPath)]
    : [path.resolve("factorio-test.json"), path.resolve("package.json")]

  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const rawConfig = filePath.endsWith("package.json")
      ? content["factorio-test"]
      : content

    if (!rawConfig) continue

    const result = cliConfigSchema.safeParse(rawConfig)
    if (!result.success) {
      throw new Error(formatZodError(result.error, filePath))
    }
    return result.data
  }

  return {}
}

export function mergeTestConfig(
  configFile: TestRunnerConfig | undefined,
  cliOptions: Partial<TestRunnerConfig>,
): TestRunnerConfig {
  const baseTestPattern = configFile?.test_pattern
  const cliTestPattern = cliOptions.test_pattern
  const mergedTestPattern =
    cliTestPattern !== undefined
      ? baseTestPattern
        ? `(${baseTestPattern})|(${cliTestPattern})`
        : cliTestPattern
      : baseTestPattern

  return {
    ...configFile,
    test_pattern: mergedTestPattern,
    tag_whitelist: cliOptions.tag_whitelist ?? configFile?.tag_whitelist,
    tag_blacklist: cliOptions.tag_blacklist ?? configFile?.tag_blacklist,
    default_timeout: cliOptions.default_timeout ?? configFile?.default_timeout,
    game_speed: cliOptions.game_speed ?? configFile?.game_speed,
    log_passed_tests: cliOptions.log_passed_tests ?? configFile?.log_passed_tests,
    log_skipped_tests: cliOptions.log_skipped_tests ?? configFile?.log_skipped_tests,
  }
}

export { type CliConfig, type TestRunnerConfig }
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run build --workspace=cli`
- [x] Linting passes: `npm run lint --workspace=cli`
- [x] Config options test passes: `npm run test:config-options --workspace=mod`

#### Manual Verification:
- [x] Error messages for invalid config are helpful

---

## Phase 3: Update run.ts to Use Schema

### Overview
Replace imperative Commander option definitions with schema-driven generation. Use `parseCliTestOptions` to convert Commander's camelCase output to snake_case.

### Changes Required:

#### 1. Update run.ts to use schema helpers
**File**: `cli/run.ts`
**Changes**: Use schema helpers instead of manual option definitions

Replace lines 43-50 (test runner options) with call to `registerTestRunnerOptions`:

```typescript
import { registerTestRunnerOptions, parseCliTestOptions } from "./schema.js"

// After other .option() calls, before .action():
registerTestRunnerOptions(thisCommand)
```

Replace lines 118-138 (pattern handling and config mapping) with:

```typescript
const cliTestOptions = parseCliTestOptions(options)
const allPatterns = [fileConfig.test?.test_pattern, cliTestOptions.test_pattern, ...patterns].filter(Boolean) as string[]
const combinedPattern = allPatterns.length > 0 ? allPatterns.map((p) => `(${p})`).join("|") : undefined

const testConfig = mergeTestConfig(fileConfig.test, {
  ...cliTestOptions,
  test_pattern: combinedPattern,
})

if (Object.keys(testConfig).length > 0) {
  await runScript(
    "fmtk settings set runtime-global factorio-test-config",
    `'${JSON.stringify(testConfig)}'`,
    "--modsPath",
    modsDir,
  )
}
```

No conversion needed when writing to Factorio settings - already snake_case.

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run build --workspace=cli`
- [x] Linting passes: `npm run lint --workspace=cli`
- [x] All integration tests pass: `npm run test --workspace=mod`
- [x] CLI help output is correct: `npx factorio-test run --help`

#### Manual Verification:
- [x] Verify CLI works end-to-end with actual Factorio run

---

## Phase 4: Split run.ts into Modules

### Overview
Extract testable units from monolithic run.ts into separate modules.

### Changes Required:

#### 1. Create factorio-process.ts
**File**: `cli/factorio-process.ts` (new file)
**Changes**: Extract Factorio spawning and output parsing

```typescript
import { spawn } from "child_process"
import * as path from "path"
import BufferLineSplitter from "./buffer-line-splitter.js"

export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "error"
  message?: string
}

export async function runFactorioTests(
  factorioPath: string,
  dataDir: string,
  additionalArgs: string[],
  options: { verbose?: boolean; showOutput?: boolean },
): Promise<FactorioTestResult> {
  const args = [
    "--load-scenario",
    "factorio-test/Test",
    "--disable-migration-window",
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    "--graphics-quality",
    "low",
    ...additionalArgs,
  ]

  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  let resultMessage: string | undefined
  let isMessage = false
  let isMessageFirstLine = true

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      resultMessage = line.slice("FACTORIO-TEST-RESULT:".length)
      factorioProcess.kill()
    } else if (line === "FACTORIO-TEST-MESSAGE-START") {
      isMessage = true
      isMessageFirstLine = true
    } else if (line === "FACTORIO-TEST-MESSAGE-END") {
      isMessage = false
    } else if (options.verbose) {
      console.log(line)
    } else if (isMessage && options.showOutput) {
      if (isMessageFirstLine) {
        console.log(line.slice(line.indexOf(": ") + 2))
        isMessageFirstLine = false
      } else {
        console.log("    " + line)
      }
    }
  })

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (code === 0 && resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })

  return {
    status: resultMessage as "passed" | "failed" | "todo" | "error",
    message: resultMessage,
  }
}
```

#### 2. Create mod-setup.ts
**File**: `cli/mod-setup.ts` (new file)
**Changes**: Extract mod configuration and symlink logic

```typescript
import * as fsp from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import { runScript } from "./process-utils.js"

export async function configureModToTest(
  modsDir: string,
  modPath?: string,
  modName?: string,
  verbose?: boolean,
): Promise<string> {
  if (modPath) {
    if (verbose) console.log("Creating mod symlink", modPath)
    return configureModPath(modPath, modsDir)
  } else {
    await configureModName(modsDir, modName!)
    return modName!
  }
}

async function configureModPath(modPath: string, modsDir: string): Promise<string> {
  modPath = path.resolve(modPath)
  const infoJsonFile = path.join(modPath, "info.json")
  let infoJson: { name: unknown }
  try {
    infoJson = JSON.parse(await fsp.readFile(infoJsonFile, "utf8")) as { name: unknown }
  } catch (e) {
    throw new Error(`Could not read info.json file from ${modPath}`, { cause: e })
  }
  const modName = infoJson.name
  if (typeof modName !== "string") {
    throw new Error(`info.json file at ${infoJsonFile} does not contain a string property "name".`)
  }
  const resultPath = path.join(modsDir, modName)
  const stat = await fsp.stat(resultPath).catch(() => undefined)
  if (stat) await fsp.rm(resultPath, { recursive: true })

  await fsp.symlink(modPath, resultPath, "junction")
  return modName
}

async function configureModName(modsDir: string, modName: string): Promise<void> {
  const exists = await checkModExists(modsDir, modName)
  if (!exists) {
    throw new Error(`Mod ${modName} not found in ${modsDir}.`)
  }
}

export async function checkModExists(modsDir: string, modName: string): Promise<boolean> {
  const stat = await fsp.stat(modsDir).catch(() => undefined)
  if (!stat?.isDirectory()) return false

  const files = await fsp.readdir(modsDir)
  return files.some((f) => {
    const fileStat = fs.statSync(path.join(modsDir, f), { throwIfNoEntry: false })
    if (fileStat?.isDirectory()) {
      return f === modName || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+$`))
    }
    if (fileStat?.isFile()) {
      return f === modName + ".zip" || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+\\.zip$`))
    }
    return false
  })
}

export async function installFactorioTest(modsDir: string): Promise<void> {
  await fsp.mkdir(modsDir, { recursive: true })
  const exists = await checkModExists(modsDir, "factorio-test")
  if (!exists) {
    console.log("Downloading factorio-test from mod portal using fmtk.")
    await runScript("fmtk mods install", "--modsPath", modsDir, "factorio-test")
  }
}

export async function ensureConfigIni(dataDir: string): Promise<void> {
  const filePath = path.join(dataDir, "config.ini")
  if (!fs.existsSync(filePath)) {
    console.log("Creating config.ini file")
    await fsp.writeFile(
      filePath,
      `; This file was auto-generated by factorio-test cli

[path]
read-data=__PATH__executable__/../../data
write-data=${dataDir}

[general]
locale=
`,
    )
  } else {
    const content = await fsp.readFile(filePath, "utf8")
    const newContent = content.replace(/^write-data=.*$/m, `write-data=${dataDir}`)
    if (content !== newContent) {
      await fsp.writeFile(filePath, newContent)
    }
  }
}
```

#### 3. Create process-utils.ts
**File**: `cli/process-utils.ts` (new file)
**Changes**: Extract process spawning utilities

```typescript
import { spawn } from "child_process"

let verbose = false

export function setVerbose(v: boolean): void {
  verbose = v
}

export function runScript(...command: string[]): Promise<void> {
  return runProcess(true, "npx", ...command)
}

export function runProcess(
  inheritStdio: boolean,
  command: string,
  ...args: string[]
): Promise<void> {
  if (verbose) console.log("Running:", command, ...args)
  const proc = spawn(command, args, {
    stdio: inheritStdio ? "inherit" : "ignore",
    shell: true,
  })
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}: ${command} ${args.join(" ")}`))
      }
    })
  })
}
```

#### 4. Create factorio-detect.ts
**File**: `cli/factorio-detect.ts` (new file)
**Changes**: Extract Factorio path detection

```typescript
import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"

function factorioIsInPath(): boolean {
  const result = spawnSync("factorio", ["--version"], { stdio: "ignore" })
  return result.status === 0
}

export function autoDetectFactorioPath(): string {
  if (factorioIsInPath()) {
    return "factorio"
  }

  let pathsToTry: string[]
  if (os.platform() === "linux" || os.platform() === "darwin") {
    pathsToTry = [
      "~/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
      "~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
      "~/.factorio/bin/x64/factorio",
      "/Applications/factorio.app/Contents/MacOS/factorio",
      "/usr/share/factorio/bin/x64/factorio",
      "/usr/share/games/factorio/bin/x64/factorio",
    ]
  } else if (os.platform() === "win32") {
    pathsToTry = [
      "factorio.exe",
      process.env["ProgramFiles(x86)"] + "\\Steam\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe",
      process.env["ProgramFiles"] + "\\Factorio\\bin\\x64\\factorio.exe",
    ]
  } else {
    throw new Error(`Cannot auto-detect factorio path on platform ${os.platform()}`)
  }

  pathsToTry = pathsToTry.map((p) => p.replace(/^~\//, os.homedir() + "/"))

  for (const testPath of pathsToTry) {
    if (fs.statSync(testPath, { throwIfNoEntry: false })?.isFile()) {
      return path.resolve(testPath)
    }
  }

  throw new Error(
    `Could not auto-detect factorio executable. Tried: ${pathsToTry.join(", ")}. ` +
      "Either add the factorio bin to your path, or specify the path with --factorio-path",
  )
}
```

#### 5. Simplify run.ts
**File**: `cli/run.ts`
**Changes**: Import from new modules, keep only orchestration

The file should shrink to ~100-150 lines, importing from:
- `./schema.js` for option registration and mapping
- `./config.js` for config loading and merging
- `./factorio-process.js` for test execution
- `./mod-setup.js` for mod configuration
- `./process-utils.js` for script running
- `./factorio-detect.js` for path detection

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `npm run build --workspace=cli`
- [x] Linting passes: `npm run lint --workspace=cli`
- [x] All integration tests pass: `npm run test --workspace=mod`

#### Manual Verification:
- [x] Code review confirms each module has single responsibility
- [x] run.ts is now focused on orchestration only

---

## Phase 5: Add Unit Tests

### Overview
Add unit tests for the extracted modules that don't require Factorio.

### Changes Required:

#### 1. Add test dependencies
**File**: `cli/package.json`
**Changes**: Add vitest for testing

```json
"devDependencies": {
  "@commander-js/extra-typings": "^12.1.0",
  "del-cli": "^6.0.0",
  "typescript": "^5.9.3",
  "vitest": "^3.0.0"
},
"scripts": {
  "build": "npm run clean && tsc",
  "lint": "eslint .",
  "test": "vitest run",
  "test:watch": "vitest",
  "prepublishOnly": "npm run build",
  "clean": "del-cli \"*.js\" \"*.d.ts\" \"*.js.map\""
}
```

#### 2. Create test for schema
**File**: `cli/schema.test.ts` (new file)

```typescript
import { describe, it, expect } from "vitest"
import {
  testRunnerConfigSchema,
  cliConfigSchema,
  parseCliTestOptions,
} from "./schema.js"

describe("testRunnerConfigSchema", () => {
  it("parses valid config with snake_case keys", () => {
    const config = {
      test_pattern: "foo",
      game_speed: 100,
      log_passed_tests: true,
    }
    expect(testRunnerConfigSchema.parse(config)).toEqual(config)
  })

  it("rejects invalid types", () => {
    expect(() => testRunnerConfigSchema.parse({ game_speed: "fast" })).toThrow()
  })

  it("allows empty config", () => {
    expect(testRunnerConfigSchema.parse({})).toEqual({})
  })
})

describe("cliConfigSchema", () => {
  it("parses config file with snake_case test keys", () => {
    const config = {
      modPath: "./my-mod",
      test: { game_speed: 50, log_passed_tests: true },
    }
    expect(cliConfigSchema.parse(config)).toEqual(config)
  })

  it("rejects unknown keys in strict mode", () => {
    expect(() => cliConfigSchema.strict().parse({ unknownKey: true })).toThrow()
  })
})

describe("parseCliTestOptions", () => {
  it("converts Commander camelCase output to snake_case", () => {
    const commanderOpts = {
      testPattern: "foo",
      gameSpeed: 100,
      logPassedTests: true,
    }
    expect(parseCliTestOptions(commanderOpts)).toEqual({
      test_pattern: "foo",
      game_speed: 100,
      log_passed_tests: true,
    })
  })

  it("omits undefined values", () => {
    expect(parseCliTestOptions({ gameSpeed: 100 })).toEqual({ game_speed: 100 })
  })

  it("returns empty object for empty input", () => {
    expect(parseCliTestOptions({})).toEqual({})
  })
})
```

#### 3. Create test for config
**File**: `cli/config.test.ts` (new file)

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { loadConfig, mergeTestConfig } from "./config.js"

const testDir = path.join(import.meta.dirname, "__test_fixtures__")

describe("loadConfig", () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty object when no config exists", () => {
    expect(loadConfig(path.join(testDir, "nonexistent.json"))).toEqual({})
  })

  it("loads factorio-test.json with snake_case test config", () => {
    const configPath = path.join(testDir, "factorio-test.json")
    fs.writeFileSync(configPath, JSON.stringify({
      modPath: "./test",
      test: { game_speed: 100 }
    }))
    expect(loadConfig(configPath)).toEqual({
      modPath: "./test",
      test: { game_speed: 100 }
    })
  })

  it("throws on invalid keys", () => {
    const configPath = path.join(testDir, "bad.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { invalid_key: true } }))
    expect(() => loadConfig(configPath)).toThrow()
  })
})

describe("mergeTestConfig", () => {
  it("CLI options override config file", () => {
    const result = mergeTestConfig(
      { game_speed: 100 },
      { game_speed: 200 },
    )
    expect(result.game_speed).toBe(200)
  })

  it("combines test patterns with OR", () => {
    const result = mergeTestConfig(
      { test_pattern: "foo" },
      { test_pattern: "bar" },
    )
    expect(result.test_pattern).toBe("(foo)|(bar)")
  })

  it("preserves config file values when CLI undefined", () => {
    const result = mergeTestConfig(
      { game_speed: 100, log_passed_tests: true },
      {},
    )
    expect(result.game_speed).toBe(100)
    expect(result.log_passed_tests).toBe(true)
  })
})
```

#### 4. Create test for factorio-detect
**File**: `cli/factorio-detect.test.ts` (new file)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as os from "os"
import * as fs from "fs"

vi.mock("child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
}))

describe("autoDetectFactorioPath", () => {
  const originalPlatform = process.platform

  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform })
  })

  it("returns 'factorio' if in PATH", async () => {
    const { spawnSync } = await import("child_process")
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as any)

    const { autoDetectFactorioPath } = await import("./factorio-detect.js")
    expect(autoDetectFactorioPath()).toBe("factorio")
  })

  it("throws if no path found", async () => {
    const { spawnSync } = await import("child_process")
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as any)
    vi.spyOn(fs, "statSync").mockReturnValue(undefined as any)

    const { autoDetectFactorioPath } = await import("./factorio-detect.js")
    expect(() => autoDetectFactorioPath()).toThrow(/Could not auto-detect/)
  })
})
```

#### 5. Add vitest config
**File**: `cli/vitest.config.ts` (new file)

```typescript
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
  },
})
```

### Success Criteria:

#### Automated Verification:
- [x] Unit tests pass: `npm run test --workspace=cli`
- [x] TypeScript compiles: `npm run build --workspace=cli`
- [x] Integration tests still pass: `npm run test --workspace=mod`

#### Manual Verification:
- [x] Test coverage for critical paths (config parsing, merging)

---

## Testing Strategy

### Unit Tests (new):
- Schema validation (valid/invalid configs)
- CLI option parsing (camelCase → snake_case)
- Config merging logic
- Factorio path detection (mocked)

### Integration Tests (existing):
- `test-config-options.ts` - CLI option handling
- `test-usage-test-mod.ts` - End-to-end with Factorio

### Manual Testing Steps:
1. Run CLI with various option combinations
2. Test config file loading from different locations
3. Verify error messages are helpful for invalid configs

## Migration Notes

- `types/config.d.ts` unchanged - keeps snake_case interface for mod consumers
- Config files continue to use snake_case (no user-facing changes)
- CLI options unchanged (still kebab-case)
- Internal CLI code now uses snake_case consistently (matches config files and Lua)
- Only conversion point: CLI kebab-case → snake_case via `parseCliTestOptions`
- No changes to mod-side code required

## References

- Current CLI implementation: `cli/run.ts`
- Config validation: `cli/config.ts`
- Type definitions: `types/config.d.ts`
- Integration tests: `scripts/test-config-options.ts`
