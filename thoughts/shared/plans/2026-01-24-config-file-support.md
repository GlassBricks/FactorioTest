# Config File Support Implementation Plan

## Overview

Add config file support to collect CLI arguments, reducing command-line complexity for projects with many options. Configuration flows from config file → CLI options → mod settings → mod runtime.

## Current State

- CLI (`cli/run.ts`) accepts: `[mod-path]`, `--mod-name`, `--factorio-path`, `-d/--data-directory`, `--mods`, `--show-output`, `-v/--verbose`
- Arguments after `--` pass through to Factorio
- No config file support exists
- Test runner config (pattern, tags, timeout, etc.) can only be set in mod code via `init()`
- Two Factorio settings exist: `factorio-test-auto-start` (startup bool), `factorio-test-mod-to-test` (runtime-global string)

## Desired End State

1. Config file (`factorio-test.json` or `--config` path) stores all CLI and test runner options
2. CLI options override config file values
3. Test runner config transfers to mod via new `factorio-test-config` setting (JSON string)
4. Mod reads settings config and merges with mod-provided config (settings take precedence)
5. Shared TypeScript types ensure CLI and mod agree on config shape

### Verification

- `factorio-test run ./mod --test-pattern foo` runs only tests matching "foo"
- `factorio-test run ./mod --game-speed 500` runs tests at speed 500
- Config file options work identically to CLI options
- Existing mod-side `init()` config still works but CLI/config file overrides it

## Breaking Changes

This release requires a **major version bump** due to:
- Positional `[patterns...]` argument after `[mod-path]` changes CLI usage

## What We're NOT Doing

- YAML/TOML config formats (JSON only)
- Config file generation/init command
- Changing existing `tag_whitelist`/`tag_blacklist` naming

## Implementation Approach

1. Create shared types for test runner config
2. Add new Factorio setting for config transfer
3. Update CLI with config file loading and new options
4. Update mod to read settings and merge configs

---

## Phase 1: Shared Types and Setting

### Overview

Create the shared type definition and add the Factorio setting for config transfer.

### Changes Required

#### 1. Create shared types directory

**File**: `shared/config.ts` (new)

```typescript
export interface TestRunnerConfig {
  test_pattern?: string
  tag_whitelist?: string[]
  tag_blacklist?: string[]
  default_timeout?: number
  game_speed?: number
  log_passed_tests?: boolean
  log_skipped_tests?: boolean
}
```

#### 2. Add config setting constant

**File**: `mod/constants.d.ts`

Add to `Settings` enum:
```typescript
export const enum Settings {
  ModToTest = "factorio-test-mod-to-test",
  AutoStart = "factorio-test-auto-start",
  Config = "factorio-test-config",
}
```

#### 3. Register Factorio setting

**File**: `mod/settings.ts`

Add new setting:
```typescript
{
  type: "string-setting",
  setting_type: "runtime-global",
  name: Settings.Config,
  default_value: "{}",
  allow_blank: true,
  hidden: true,
  order: "c",
}
```

#### 4. Update CLI tsconfig

**File**: `cli/tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Node",
    "skipLibCheck": true,
    "strict": true,
    "rootDir": ".."
  },
  "include": [".", "../shared"]
}
```

#### 5. Update mod tsconfig

**File**: `mod/tsconfig.json`

Add to include array:
```json
"include": [
  ".",
  "../types/index.d.ts",
  "../shared"
]
```

### Success Criteria

#### Automated Verification
- [ ] `npm run build --workspace=cli` succeeds
- [ ] `npm run build --workspace=mod` succeeds
- [ ] TypeScript finds `TestRunnerConfig` type in both workspaces

---

## Phase 2: CLI Config File Loading

### Overview

Add config file discovery and loading to CLI.

### Changes Required

#### 1. Add config loading utilities

**File**: `cli/config.ts` (new)

```typescript
import * as fs from "fs"
import * as path from "path"
import type { TestRunnerConfig } from "../shared/config.js"

export interface CliConfig {
  modPath?: string
  modName?: string
  factorioPath?: string
  dataDirectory?: string
  mods?: string[]
  verbose?: boolean
  showOutput?: boolean
  factorioArgs?: string[]
  test?: TestRunnerConfig
}

const validCliConfigKeys = new Set([
  "modPath", "modName", "factorioPath", "dataDirectory",
  "mods", "verbose", "showOutput", "factorioArgs", "test",
])

const validTestConfigKeys = new Set([
  "test_pattern", "tag_whitelist", "tag_blacklist",
  "default_timeout", "game_speed", "log_passed_tests", "log_skipped_tests",
])

function validateConfig(config: Record<string, unknown>, filePath: string): void {
  for (const key of Object.keys(config)) {
    if (!validCliConfigKeys.has(key)) {
      throw new Error(`Unknown config key "${key}" in ${filePath}`)
    }
  }
  if (config.test && typeof config.test === "object") {
    for (const key of Object.keys(config.test)) {
      if (!validTestConfigKeys.has(key)) {
        throw new Error(`Unknown test config key "${key}" in ${filePath}`)
      }
    }
  }
}

export function loadConfig(configPath?: string): CliConfig {
  const paths = configPath
    ? [path.resolve(configPath)]
    : [
        path.resolve("factorio-test.json"),
        path.resolve("package.json"),
      ]

  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))

    if (filePath.endsWith("package.json")) {
      if (content["factorio-test"]) {
        validateConfig(content["factorio-test"], filePath)
        return content["factorio-test"] as CliConfig
      }
      continue
    }

    validateConfig(content, filePath)
    return content as CliConfig
  }

  return {}
}

export function mergeTestConfig(
  configFile: TestRunnerConfig | undefined,
  cliOptions: Partial<TestRunnerConfig>,
): TestRunnerConfig {
  const result: TestRunnerConfig = { ...configFile }

  if (cliOptions.test_pattern !== undefined) {
    result.test_pattern = result.test_pattern
      ? `(${result.test_pattern})|(${cliOptions.test_pattern})`
      : cliOptions.test_pattern
  }
  if (cliOptions.tag_whitelist !== undefined) {
    result.tag_whitelist = cliOptions.tag_whitelist
  }
  if (cliOptions.tag_blacklist !== undefined) {
    result.tag_blacklist = cliOptions.tag_blacklist
  }
  if (cliOptions.default_timeout !== undefined) {
    result.default_timeout = cliOptions.default_timeout
  }
  if (cliOptions.game_speed !== undefined) {
    result.game_speed = cliOptions.game_speed
  }
  if (cliOptions.log_passed_tests !== undefined) {
    result.log_passed_tests = cliOptions.log_passed_tests
  }
  if (cliOptions.log_skipped_tests !== undefined) {
    result.log_skipped_tests = cliOptions.log_skipped_tests
  }

  return result
}
```

### Success Criteria

#### Automated Verification
- [ ] `npm run build --workspace=cli` succeeds
- [ ] Config module exports `loadConfig` and `mergeTestConfig`

---

## Phase 3: CLI Options and Integration

### Overview

Add test runner CLI options and integrate config loading into the run command.

### Changes Required

#### 1. Update run command with new options

**File**: `cli/run.ts`

Add imports:
```typescript
import { loadConfig, mergeTestConfig, type CliConfig } from "./config.js"
import type { TestRunnerConfig } from "../shared/config.js"
```

Add new options to command definition (after existing options, before `.addHelpText`):
```typescript
.option("--config <path>", "Path to config file")
.option("--test-pattern <pattern>", "Pattern to filter tests")
.option("--tag-whitelist <tags...>", "Only run tests with these tags")
.option("--tag-blacklist <tags...>", "Skip tests with these tags")
.option("--default-timeout <ticks>", "Default test timeout in ticks", parseInt)
.option("--game-speed <speed>", "Game speed multiplier", parseInt)
.option("--log-passed-tests", "Log passed test names")
.option("--no-log-passed-tests", "Don't log passed test names")
.option("--log-skipped-tests", "Log skipped test names")
```

Update `runTests` function signature to accept new options and add config loading at the start:
```typescript
async function runTests(
  modPath: string | undefined,
  options: {
    config?: string
    factorioPath?: string
    modName?: string
    dataDirectory: string
    verbose?: true
    showOutput?: boolean
    mods?: string[]
    testPattern?: string
    tagWhitelist?: string[]
    tagBlacklist?: string[]
    defaultTimeout?: number
    gameSpeed?: number
    logPassedTests?: boolean
    logSkippedTests?: boolean
  },
) {
  const fileConfig = loadConfig(options.config)

  // Apply config file defaults for CLI options
  modPath ??= fileConfig.modPath
  options.modName ??= fileConfig.modName
  options.factorioPath ??= fileConfig.factorioPath
  options.dataDirectory ??= fileConfig.dataDirectory ?? "./factorio-test-data-dir"
  options.mods ??= fileConfig.mods
  options.verbose ??= fileConfig.verbose
  options.showOutput ??= fileConfig.showOutput ?? true

  // ... existing validation ...
```

#### 2. Build and write test config to settings

In `runTests`, after `setSettingsForAutorun` call, add:
```typescript
const testConfig = mergeTestConfig(fileConfig.test, {
  test_pattern: options.testPattern,
  tag_whitelist: options.tagWhitelist,
  tag_blacklist: options.tagBlacklist,
  default_timeout: options.defaultTimeout,
  game_speed: options.gameSpeed,
  log_passed_tests: options.logPassedTests,
  log_skipped_tests: options.logSkippedTests,
})

if (Object.keys(testConfig).length > 0) {
  await runScript(
    "fmtk settings set runtime-global factorio-test-config",
    JSON.stringify(testConfig),
    "--modsPath",
    modsDir,
  )
}
```

#### 3. Handle positional test patterns

Update argument definition to allow multiple patterns:
```typescript
.argument("[mod-path]", "...")
.argument("[patterns...]", "Test patterns to filter (OR logic)")
```

Merge positional patterns with `--test-pattern`:
```typescript
// After loading config
const allPatterns = [
  fileConfig.test?.test_pattern,
  options.testPattern,
  ...(patterns ?? []),
].filter(Boolean)

const combinedPattern = allPatterns.length > 0
  ? allPatterns.map(p => `(${p})`).join("|")
  : undefined
```

### Success Criteria

#### Automated Verification
- [ ] `npm run build --workspace=cli` succeeds
- [ ] `factorio-test run --help` shows new options
- [ ] `npm run test --workspace=mod` passes

#### Manual Verification
- [ ] `factorio-test run ./mod --test-pattern foo` filters tests
- [ ] `factorio-test run ./mod --game-speed 500` changes game speed
- [ ] Config file values are used when CLI options not provided

---

## Phase 4: Mod Config Reading

### Overview

Update mod to read the config setting and merge with mod-provided config.

### Changes Required

#### 1. Add settings config reader

**File**: `mod/factorio-test/config.ts`

```typescript
import Config = FactorioTest.Config
import { Settings } from "../constants"
import type { TestRunnerConfig } from "../../shared/config"

function getSettingsConfig(): Partial<Config> {
  const json = settings.global[Settings.Config]?.value as string | undefined
  if (!json || json === "{}") return {}
  return helpers.json_to_table(json) as Partial<Config>
}

export function fillConfig(modConfig: Partial<Config>): Config {
  const settingsConfig = getSettingsConfig()

  return {
    default_timeout: 60 * 60,
    default_ticks_between_tests: 1,
    game_speed: 1000,
    log_passed_tests: true,
    log_skipped_tests: false,
    sound_effects: false,
    load_luassert: true,
    ...modConfig,
    ...settingsConfig,
  }
}
```

The order ensures: framework defaults → mod config → settings config (CLI/config file).

### Success Criteria

#### Automated Verification
- [ ] `npm run build --workspace=mod` succeeds
- [ ] `npm run test --workspace=mod` passes

#### Manual Verification
- [ ] Test with `--game-speed 100` and verify game runs at that speed
- [ ] Test with config file containing `{"test": {"game_speed": 100}}` and verify it works
- [ ] Test that mod-provided config is overridden by CLI options

---

## Phase 5: Cleanup Config Setting After Run

### Overview

Reset the config setting after test run to avoid persisting between runs.

### Changes Required

**File**: `cli/run.ts`

In the `finally` block after the test run:
```typescript
try {
  resultMessage = await runFactorioTests(factorioPath, dataDir)
} finally {
  if (options.verbose) console.log("Disabling auto-start settings")
  await runScript("fmtk settings set startup factorio-test-auto-start false", "--modsPath", modsDir)
  await runScript("fmtk settings set runtime-global factorio-test-config", "{}", "--modsPath", modsDir)
}
```

### Success Criteria

#### Automated Verification
- [ ] `npm run test --workspace=mod` passes
- [ ] Running tests twice with different options uses correct options each time

---

## Testing Strategy

### Unit Tests
- Config file parsing with valid JSON
- Config file parsing with missing file (returns empty)
- Config validation errors on unknown keys
- Config merging with various combinations of sources
- Test pattern OR combination

### Integration Tests
- Full test run with config file
- Full test run with CLI options
- Full test run with both (verify override behavior)

### Manual Testing Steps
1. Create `factorio-test.json` with `{"test": {"game_speed": 100}}`
2. Run `factorio-test run ./mod` - verify speed is 100
3. Run `factorio-test run ./mod --game-speed 500` - verify speed is 500 (CLI overrides)
4. Test `package.json` "factorio-test" key works
5. Test `--config custom.json` works
6. Test config with unknown key `{"badKey": true}` - verify error is thrown

## Files Summary

| File | Changes |
|------|---------|
| `shared/config.ts` | New - shared TestRunnerConfig type |
| `cli/tsconfig.json` | Add `../shared` to include, update rootDir |
| `cli/config.ts` | New - config loading and merging with validation |
| `cli/run.ts` | Add options, load config, write settings |
| `cli/package.json` | Bump major version (breaking change) |
| `mod/tsconfig.json` | Add `../shared` to include |
| `mod/constants.d.ts` | Add `Settings.Config` |
| `mod/settings.ts` | Add `factorio-test-config` setting |
| `mod/factorio-test/config.ts` | Read settings, merge configs |
