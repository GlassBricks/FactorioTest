# Config File Support

## Overview

Support a config file to collect CLI arguments, reducing command-line complexity for projects with many options.

## Format

JSON is recommended:

- Built-in Node.js support (no dependencies)
- Matches Factorio ecosystem (info.json, mod-list.json)
- TypeScript integration for schema validation

## File Locations (Priority Order)

1. `--config <file>` - Explicit path (CLI-only option)
2. `factorio-test.json` - Project root (default)
3. `package.json` "factorio-test" key - NPM convention

## Config Categories

### 1. CLI Config

Options that affect Factorio binary execution and the test runner process.

| Option          | Type     | Default                    | Description                                          |
| --------------- | -------- | -------------------------- | ---------------------------------------------------- |
| `modPath`       | string   | -                          | Path to mod folder (mutually exclusive with modName) |
| `modName`       | string   | -                          | Name of installed mod to test                        |
| `factorioPath`  | string   | auto-detect                | Path to Factorio executable                          |
| `dataDirectory` | string   | `./factorio-test-data-dir` | Factorio data directory                              |
| `mods`          | string[] | -                          | Additional mods to enable                            |
| `verbose`       | boolean  | false                      | Enable verbose logging                               |
| `showOutput`    | boolean  | true                       | Print test output to stdout                          |
| `factorioArgs`  | string[] | -                          | Arguments passed to Factorio process                 |

**Specifiable via:** Config file, CLI options

### 2. Test Runner Config

Options that control test execution behavior. These can be specified in multiple places with defined override priority.

| Option            | Type     | Default | Description                    |
| ----------------- | -------- | ------- | ------------------------------ |
| `testPattern`     | string   | -       | Pattern to filter tests        |
| `tagAllowlist`    | string[] | -       | Only run tests with these tags |
| `tagDenylist`     | string[] | -       | Skip tests with these tags     |
| `defaultTimeout`  | number   | 3600    | Default test timeout (ticks)   |
| `gameSpeed`       | number   | 1000    | Game speed multiplier          |
| `logPassedTests`  | boolean  | true    | Log passed test names          |
| `logSkippedTests` | boolean  | false   | Log skipped test names         |

**Specifiable via:** Config file, CLI options, mod code

**Override priority (highest to lowest):**

```
CLI arguments
  ↓
Config file ("test" section)
  ↓
Mod code (passed to init())
  ↓
Framework defaults
```

### 3. Mod Config

Options that only make sense in mod code context.

| Option                     | Type     | Default | Description                 |
| -------------------------- | -------- | ------- | --------------------------- |
| `defaultTicksBetweenTests` | number   | 1       | Ticks to wait between tests |
| `soundEffects`             | boolean  | false   | Play sound effects          |
| `loadLuassert`             | boolean  | true    | Load luassert library       |
| `beforeTestRun`            | function | -       | Hook before test run        |
| `afterTestRun`             | function | -       | Hook after test run         |

**Specifiable via:** Mod code only (passed to `init()`)

## Config Structure

```json
{
  "modPath": "./my-mod",
  "dataDirectory": "./test-data",
  "mods": ["base", "quality"],
  "verbose": false,
  "showOutput": true,
  "factorioArgs": ["--cache-sprite-atlas", "--disable-audio"],

  "test": {
    "testPattern": "inventory",
    "defaultTimeout": 3600,
    "gameSpeed": 500,
    "logPassedTests": true,
    "tagDenylist": ["slow"]
  }
}
```

## CLI Usage

Positional arguments are test pattern filters:

```bash
# Run tests matching "inventory"
factorio-test run ./my-mod inventory

# Multiple patterns (OR)
factorio-test run ./my-mod inventory crafting
```

Factorio arguments via option:

```bash
factorio-test run ./my-mod --factorio-args="--cache-sprite-atlas --disable-audio"
```

CLI options mirror config file keys:

```bash
factorio-test run ./my-mod \
  --data-directory ./test-data \
  --mods base quality \
  --verbose \
  --test-pattern "inventory" \
  --game-speed 500
```

## CLI-to-Mod Data Transfer

Test runner config is transferred from CLI to mod via a single Factorio string setting containing JSON.

### Factorio Setting

Add to `mod/settings.ts`:

```typescript
{
  type: "string-setting",
  setting_type: "runtime-global",
  name: "factorio-test-config",
  default_value: "{}",
  allow_blank: true
}
```

### CLI Side (cli/run.ts)

After merging config file and CLI options, serialize test runner config to JSON:

```typescript
const testConfig: Partial<TestRunnerConfig> = {
  test_pattern: options.testPattern,
  tag_allowlist: options.tagAllowlist,
  tag_denylist: options.tagDenylist,
  default_timeout: options.defaultTimeout,
  game_speed: options.gameSpeed,
  log_passed_tests: options.logPassedTests,
  log_skipped_tests: options.logSkippedTests,
}
await runScript(
  "fmtk settings set runtime-global factorio-test-config",
  JSON.stringify(testConfig),
  "--modsPath",
  modsDir,
)
```

### Mod Side

Read and parse the JSON config, merge with mod-provided config:

```typescript
function getSettingsConfig(): Partial<TestRunnerConfig> {
  const json = settings.global["factorio-test-config"].value as string
  return helpers.json_to_table(json) as Partial<TestRunnerConfig>
}

// In init():
const settingsConfig = getSettingsConfig()
const finalConfig = fillConfig({ ...modConfig, ...settingsConfig })
```

Settings override mod config because CLI/config file should take precedence.

## Shared Types

Create `shared/config.ts` at project root for types used by both CLI and mod:

```typescript
export interface TestRunnerConfig {
  test_pattern?: string
  tag_allowlist?: string[]
  tag_denylist?: string[]
  default_timeout?: number
  game_speed?: number
  log_passed_tests?: boolean
  log_skipped_tests?: boolean
}
```

Both packages include via tsconfig:
- `cli/tsconfig.json`: add `"../shared"` to `include`
- `mod/tsconfig.json`: add `"../shared"` to `include` (already has pattern with `../types/index.d.ts`)

## Files to Modify

| File                          | Changes                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `shared/config.ts`            | New file with shared TestRunnerConfig interface         |
| `cli/tsconfig.json`           | Add `"../shared"` to include                            |
| `cli/run.ts`                  | Config loading, merge logic, write settings to Factorio |
| `cli/cli.ts`                  | Add `--config` option, test runner CLI options          |
| `mod/tsconfig.json`           | Add `"../shared"` to include                            |
| `mod/settings.ts`             | Add `factorio-test-config` setting                      |
| `mod/factorio-test/config.ts` | Read settings, merge with mod config                    |

## Implementation Notes

- Use `fs.existsSync()` and `JSON.parse()` for config loading
- Validate required fields and types
- Warn on unknown keys
- Transform camelCase config keys to match Commander option names (kebab-case)
- Commander's `program.opts()` returns CLI options; check which were explicitly set vs defaulted to determine override behavior
